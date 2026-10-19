"""Terminal deposit instructions, explicit SOL withdrawal, and balance reconciliation."""
import argparse
import base64
import json
import os
import socket
import ssl
import time
import urllib.error
from dataclasses import dataclass
from decimal import InvalidOperation
from pathlib import Path

from funding_check import lamports
from live import Executor, ExecutionUncertain, save
from pump_live import MAINNET, sol_usd
from wallet_setup import DEFAULT_WALLET, load_wallet

STATE = Path(".local/pump-live-state.json")
PENDING = Path(".local/withdraw-pending.json")


@dataclass
class Progress:
    stage: str = "wallet loading"
    broadcast_attempted: bool = False
    signature: str = ""


class InsufficientFunds(ValueError):
    def __init__(self, balance, fee, amount):
        super().__init__("Insufficient SOL after the quoted network fee")
        self.balance, self.fee, self.amount = balance, fee, amount


def withdrawal_failure(progress, exc):
    # Only render controlled messages and public numeric data, never raw exceptions:
    # provider errors and even local file errors can contain credential-bearing URLs.
    hints = {
        "Wallet must be a regular local file": "The trading wallet file is missing or is not a regular local file. Check the existing wallet with .venv/bin/python wallet_setup.py --address; do not replace it.",
        "Keep the wallet outside the project folder": "Keep the trading wallet file outside the project folder.",
        "Wallet file must have permissions 0600": "The trading wallet file must have permissions 0600 (owner access only).",
        "Invalid Solana destination": "Invalid destination. In Phantom select Solana, choose Receive, and copy its public SOL address; do not paste a placeholder, seed phrase or private key.",
        "Destination must differ from the trading wallet": "The destination is the trading wallet itself. Use your Phantom SOL receiving address.",
        "Invalid SOL amount": "Use a positive SOL amount with at most 9 decimal places, for example --sol 0.01.",
        "Live wallet lock is active": "The live bot is using this wallet. Stop its Terminal process with Control-C before withdrawing.",
        "Live ledger belongs to a different wallet": "The live ledger belongs to a different trading wallet. Verify the selected wallet; do not delete the ledger.",
        "Close/manage open positions before withdrawing or reconciling funding": "The live ledger has open positions. Manage or close them before withdrawing; do not delete the ledger.",
        "Reconcile the changed wallet balance before withdrawing": "The on-chain balance differs from the live ledger. Preview .venv/bin/python wallet_manage.py reconcile and review it before applying changes.",
        "Use an HTTPS Solana mainnet RPC": "Use an HTTPS Solana mainnet RPC; the configured endpoint is invalid or returned the wrong network.",
        "Fee quote unavailable": "The RPC did not return a valid network fee. Prepare a fresh preview using a working mainnet RPC.",
        "Fee quote changed; prepare a fresh withdrawal": "The network fee changed. Prepare a fresh withdrawal preview.",
        "Transfer simulation failed; no broadcast": "The transfer simulation failed. Check the balance and RPC before preparing a fresh preview.",
    }
    if isinstance(exc, InsufficientFunds):
        reason = f"Insufficient SOL: wallet balance {exc.balance/1e9:.9f} SOL; quoted network fee {exc.fee/1e9:.9f} SOL."
        if exc.amount is not None:
            reason += f" Requested withdrawal {exc.amount/1e9:.9f} SOL requires {(exc.amount+exc.fee)/1e9:.9f} SOL including the fee."
    elif isinstance(exc, ExecutionUncertain):
        reason = "A pending or uncertain transaction must be reconciled on-chain. Inspect the existing journals; do not delete them or blindly retry."
    elif isinstance(exc, ImportError):
        reason = "A Python dependency is missing. Run Set Up Mac.command."
    elif str(exc) in hints:
        reason = hints[str(exc)]
    elif progress.stage == "wallet loading":
        reason = "The trading wallet file is unreadable or invalid. Check .venv/bin/python wallet_setup.py --address; never share or replace the wallet file."
    elif isinstance(exc, urllib.error.HTTPError):
        reason = f"The service returned HTTP {exc.code}."
        if exc.code == 429:
            reason += " Rate limit reached; wait or configure a dedicated HTTPS mainnet RPC."
        elif exc.code in (401, 403):
            reason += " Access was denied; check the service credentials and network restrictions."
    elif isinstance(exc, (urllib.error.URLError, ssl.SSLError, TimeoutError, ConnectionError, socket.gaierror)):
        cause = exc.reason if isinstance(exc, urllib.error.URLError) else exc
        if isinstance(cause, ssl.SSLCertVerificationError):
            reason = "TLS certificate verification failed. For python.org macOS installs, run the matching Python Install Certificates.command; keep TLS verification enabled."
        elif isinstance(cause, socket.gaierror):
            reason = "DNS lookup failed. Check your internet connection and configured RPC hostname."
        elif isinstance(cause, TimeoutError):
            reason = "The connection timed out. Check connectivity or use a reachable HTTPS mainnet RPC."
        else:
            reason = "The network/TLS connection failed. Check connectivity, the configured service and network/proxy trust settings."
    elif progress.stage == "live ledger checks":
        reason = "The live ledger could not be read or is incomplete. Inspect the ledger locally; do not delete it to bypass checks."
    elif isinstance(exc, OSError):
        reason = "Local file access failed. Check folder permissions and available disk space."
    else:
        reason = "The check returned an error or unexpected response. Check the configured service and local setup."
    if progress.broadcast_attempted:
        outcome = f"A transfer may have been submitted. Check public signature {progress.signature} on-chain and .local/withdraw-pending.json before retrying."
    else:
        outcome = "No transfer was submitted by this command."
    return f"Wallet action stopped at {progress.stage}: {reason} {outcome}"


def validate_destination(key, destination):
    from solders.pubkey import Pubkey
    try:
        recipient = Pubkey.from_string(destination)
    except (ValueError, TypeError):
        raise ValueError("Invalid Solana destination") from None
    if recipient == key.pubkey():
        raise ValueError("Destination must differ from the trading wallet")
    return recipient


def transfer_plan(key, destination, balance, blockhash, amount=None, all_funds=False, fee_for_message=None):
    from solders.system_program import transfer, TransferParams
    from solders.message import Message
    from solders.transaction import Transaction
    recipient = validate_destination(key, destination)
    def make(value):
        instruction = transfer(TransferParams(from_pubkey=key.pubkey(), to_pubkey=recipient, lamports=value))
        message = Message.new_with_blockhash([instruction], key.pubkey(), blockhash)
        return message
    fee = fee_for_message(base64.b64encode(bytes(make(1))).decode())
    if not isinstance(fee, int) or isinstance(fee, bool) or fee < 0:
        raise ValueError("Fee quote unavailable")
    value = balance-fee if all_funds else amount
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0 or value+fee > balance:
        raise InsufficientFunds(balance, fee, None if all_funds else amount)
    message = make(value)
    exact_fee = fee_for_message(base64.b64encode(bytes(message)).decode())
    if exact_fee != fee:
        raise RuntimeError("Fee quote changed; prepare a fresh withdrawal")
    transaction = Transaction([key], message, blockhash)
    return transaction, {"from": str(key.pubkey()), "to": destination, "amount_lamports": value,
                         "fee_lamports": fee, "remaining_lamports": balance-value-fee}


def check_ledger(owner):
    for pending in (PENDING, Path(".local/pump-pending-trade.json")):
        if pending.exists():
            raise ExecutionUncertain("A pending signature must be reconciled before moving funds")
    if not STATE.exists():
        return None
    state = json.loads(STATE.read_text())
    if state.get("wallet") != owner:
        raise ValueError("Live ledger belongs to a different wallet")
    if state["positions"]:
        raise RuntimeError("Close/manage open positions before withdrawing or reconciling funding")
    return state


def apply_withdrawal(state, after_balance, debit):
    if state is None:
        return
    before = after_balance+debit
    cash = round(state["cash_sol"]*1e9)
    untracked = max(0, before-cash)
    new_cash = max(0, cash-max(0, debit-untracked))
    price = state.get("cash", 0)/state["cash_sol"] if state["cash_sol"] else 0
    state["cash_sol"] = new_cash/1e9
    state["cash"] = state["cash_sol"]*price
    state["wallet_balance_lamports"] = after_balance
    state["halted"] = True  # Never reset daily spending controls after a withdrawal.
    save(STATE, state)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["deposit", "withdraw", "reconcile"])
    parser.add_argument("--wallet", type=Path, default=DEFAULT_WALLET)
    parser.add_argument("--to", help="Your Phantom/public destination address")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--sol", help="Exact native SOL amount, up to 9 decimal places")
    group.add_argument("--all", action="store_true", help="Withdraw remaining SOL minus the quoted network fee")
    parser.add_argument("--execute", action="store_true", help="Explicitly enable withdrawal or reconciliation; default is read-only preview")
    args = parser.parse_args(argv)
    if args.action == "withdraw" and (not args.to or not (args.sol or args.all)):
        parser.error("withdraw requires --to and either --sol or --all")
    progress = Progress()
    try:
        run(args, progress)
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, ImportError, InvalidOperation) as exc:
        raise SystemExit(withdrawal_failure(progress, exc)) from None


def run(args, progress):
    key = load_wallet(args.wallet)
    owner = str(key.pubkey())
    if args.action == "deposit":
        print(json.dumps({"network": "Solana mainnet", "deposit_address": owner,
             "instructions": "In Phantom use Send, choose native SOL on Solana, and paste this address. Send a small test first. No transfer is made by this command.",
             "verify": "Run Check Funding.command with the public transfer signature. Stop the live bot before external funding changes."}, indent=2))
        return
    amount = None
    if args.action == "withdraw":
        progress.stage = "withdrawal input"
        validate_destination(key, args.to)
        if args.sol is not None:
            try:
                amount = lamports(args.sol)
            except (ValueError, InvalidOperation):
                raise ValueError("Invalid SOL amount") from None
    import fcntl
    progress.stage = "wallet lock"
    Path(".local").mkdir(exist_ok=True)
    with STATE.with_suffix(".lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Live wallet lock is active") from None
        progress.stage = "live ledger checks"
        state = check_ledger(owner)
        client = object.__new__(Executor)
        client.rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
        progress.stage = "Solana network verification"
        if not client.rpc_url.startswith("https://") or client.rpc("getGenesisHash", []) != MAINNET:
            raise ValueError("Use an HTTPS Solana mainnet RPC")
        progress.stage = "wallet balance lookup"
        balance = client.rpc("getBalance", [owner, {"commitment": "confirmed"}])["value"]
        if not isinstance(balance, int) or isinstance(balance, bool) or balance < 0:
            raise ValueError("Invalid wallet balance from RPC")
        if args.action == "reconcile":
            if state is None:
                print("No live ledger yet. The live bot will initialize its budget on first start.")
                return
            progress.stage = "SOL/USD reference feed"
            price = sol_usd()
            progress.stage = "funding reconciliation"
            updated_cash = min(balance/1e9, 100/price)
            change = updated_cash*price-state["cash_sol"]*price
            print(json.dumps({"wallet": owner, "balance_sol": balance/1e9, "new_tracked_cash_usd": updated_cash*price,
                              "daily_spending_counters_preserved": True, "applied": args.execute}, indent=2))
            if args.execute:
                state.update(cash_sol=updated_cash, cash=updated_cash*price, wallet_balance_lamports=balance)
                if "day_equity" in state:
                    state["day_equity"] += change
                save(STATE, state)
                Path(".local/PAUSE_BUYS").touch()
            return
        progress.stage = "wallet balance reconciliation"
        if state and state.get("wallet_balance_lamports") != balance:
            raise RuntimeError("Reconcile the changed wallet balance before withdrawing")
        from solders.hash import Hash
        progress.stage = "blockhash lookup"
        latest = client.rpc("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]
        progress.stage = "network fee and transfer preview"
        transaction, plan = transfer_plan(key, args.to, balance, Hash.from_string(latest["blockhash"]),
            amount=amount, all_funds=args.all,
            fee_for_message=lambda message: client.rpc("getFeeForMessage", [message, {"commitment": "confirmed"}])["value"])
        print(json.dumps(plan | {"trade_or_transfer_submitted": False, "preview_only": not args.execute}, indent=2))
        if not args.execute:
            return
        if input("Check the full destination above. Type WITHDRAW to submit this real transfer: ") != "WITHDRAW":
            raise SystemExit("Cancelled; no transfer submitted")
        progress.stage = "transfer simulation"
        encoded = base64.b64encode(bytes(transaction)).decode()
        simulation = client.rpc("simulateTransaction", [encoded, {"encoding": "base64", "sigVerify": True, "commitment": "confirmed"}])["value"]
        if simulation.get("err"):
            raise RuntimeError("Transfer simulation failed; no broadcast")
        signature = str(transaction.signatures[0])
        progress.signature = signature
        progress.stage = "pending journal write"
        Path(".local/PAUSE_BUYS").touch()
        save(PENDING, plan | {"signature": signature, "created_at": time.time()})
        progress.stage = "transfer broadcast"
        progress.broadcast_attempted = True
        client.rpc("sendTransaction", [encoded, {"encoding": "base64", "skipPreflight": False, "maxRetries": 2}])
        progress.stage = "transfer confirmation"
        for _ in range(60):
            tx = client.rpc("getTransaction", [signature, {"encoding": "jsonParsed", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}])
            if tx:
                meta = tx["meta"]
                if meta["err"]:
                    raise ExecutionUncertain("Transfer failed; reconcile journal and any paid fee")
                debit = meta["preBalances"][0]-meta["postBalances"][0]
                if debit != plan["amount_lamports"]+meta["fee"] or meta["fee"] != plan["fee_lamports"]:
                    raise ExecutionUncertain("Unexpected debit; reconcile the pending transfer")
                progress.stage = "confirmed transfer recording"
                apply_withdrawal(state, meta["postBalances"][0], debit)
                with Path(".local/wallet-transfers.jsonl").open("a") as log:
                    log.write(json.dumps(plan | {"signature": signature, "confirmed_at": time.time()})+"\n")
                PENDING.unlink()
                print("Transfer confirmed: "+signature+". New buys remain paused; existing daily stop state is preserved.")
                return
            time.sleep(2)
        raise ExecutionUncertain("Confirmation timeout; check the pending signature on-chain, do not blindly retry")


if __name__ == "__main__":
    main()
