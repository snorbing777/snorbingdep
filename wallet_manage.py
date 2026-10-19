"""Terminal deposit instructions, explicit SOL withdrawal, and balance reconciliation."""
import argparse
import base64
import json
import os
import time
from pathlib import Path

from funding_check import lamports
from live import Executor, ExecutionUncertain, save
from pump_live import MAINNET, sol_usd
from wallet_setup import DEFAULT_WALLET, load_wallet

STATE = Path(".local/pump-live-state.json")
PENDING = Path(".local/withdraw-pending.json")


def transfer_plan(key, destination, balance, blockhash, amount=None, all_funds=False, fee_for_message=None):
    from solders.pubkey import Pubkey
    from solders.system_program import transfer, TransferParams
    from solders.message import Message
    from solders.transaction import Transaction
    recipient = Pubkey.from_string(destination)
    if recipient == key.pubkey():
        raise ValueError("Destination must differ from the trading wallet")
    def make(value):
        instruction = transfer(TransferParams(from_pubkey=key.pubkey(), to_pubkey=recipient, lamports=value))
        message = Message.new_with_blockhash([instruction], key.pubkey(), blockhash)
        return message
    fee = fee_for_message(base64.b64encode(bytes(make(1))).decode())
    if not isinstance(fee, int) or fee < 0:
        raise ValueError("Fee quote unavailable")
    value = balance-fee if all_funds else amount
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0 or value+fee > balance:
        raise ValueError("Insufficient SOL after the quoted network fee")
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["deposit", "withdraw", "reconcile"])
    parser.add_argument("--wallet", type=Path, default=DEFAULT_WALLET)
    parser.add_argument("--to", help="Your Phantom/public destination address")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--sol", help="Exact native SOL amount, up to 9 decimal places")
    group.add_argument("--all", action="store_true", help="Withdraw remaining SOL minus the quoted network fee")
    parser.add_argument("--execute", action="store_true", help="Explicitly enable withdrawal or reconciliation; default is read-only preview")
    args = parser.parse_args()
    key = load_wallet(args.wallet)
    owner = str(key.pubkey())
    if args.action == "deposit":
        print(json.dumps({"network": "Solana mainnet", "deposit_address": owner,
             "instructions": "In Phantom use Send, choose native SOL on Solana, and paste this address. Send a small test first. No transfer is made by this command.",
             "verify": "Run Check Funding.command with the public transfer signature. Stop the live bot before external funding changes."}, indent=2))
        return
    if args.action == "withdraw" and (not args.to or not (args.sol or args.all)):
        parser.error("withdraw requires --to and either --sol or --all")
    import fcntl
    Path(".local").mkdir(exist_ok=True)
    with STATE.with_suffix(".lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Stop the live bot with Control-C first; its wallet lock is active")
        state = check_ledger(owner)
        client = object.__new__(Executor)
        client.rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
        if not client.rpc_url.startswith("https://") or client.rpc("getGenesisHash", []) != MAINNET:
            raise ValueError("Use an HTTPS Solana mainnet RPC")
        balance = client.rpc("getBalance", [owner, {"commitment": "confirmed"}])["value"]
        if args.action == "reconcile":
            if state is None:
                print("No live ledger yet. The live bot will initialize its budget on first start.")
                return
            price = sol_usd()
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
        if state and state.get("wallet_balance_lamports") != balance:
            raise RuntimeError("Reconcile the changed wallet balance before withdrawing")
        from solders.hash import Hash
        latest = client.rpc("getLatestBlockhash", [{"commitment": "confirmed"}])["value"]
        transaction, plan = transfer_plan(key, args.to, balance, Hash.from_string(latest["blockhash"]),
            amount=lamports(args.sol) if args.sol else None, all_funds=args.all,
            fee_for_message=lambda message: client.rpc("getFeeForMessage", [message, {"commitment": "confirmed"}])["value"])
        print(json.dumps(plan | {"trade_or_transfer_submitted": False, "preview_only": not args.execute}, indent=2))
        if not args.execute:
            return
        if input("Check the full destination above. Type WITHDRAW to submit this real transfer: ") != "WITHDRAW":
            raise SystemExit("Cancelled; no transfer submitted")
        encoded = base64.b64encode(bytes(transaction)).decode()
        simulation = client.rpc("simulateTransaction", [encoded, {"encoding": "base64", "sigVerify": True, "commitment": "confirmed"}])["value"]
        if simulation.get("err"):
            raise RuntimeError("Transfer simulation failed; no broadcast")
        signature = str(transaction.signatures[0])
        Path(".local/PAUSE_BUYS").touch()
        save(PENDING, plan | {"signature": signature, "created_at": time.time()})
        client.rpc("sendTransaction", [encoded, {"encoding": "base64", "skipPreflight": False, "maxRetries": 2}])
        for _ in range(60):
            tx = client.rpc("getTransaction", [signature, {"encoding": "jsonParsed", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}])
            if tx:
                meta = tx["meta"]
                if meta["err"]:
                    raise ExecutionUncertain("Transfer failed; reconcile journal and any paid fee")
                debit = meta["preBalances"][0]-meta["postBalances"][0]
                if debit != plan["amount_lamports"]+meta["fee"] or meta["fee"] != plan["fee_lamports"]:
                    raise ExecutionUncertain("Unexpected debit; reconcile the pending transfer")
                apply_withdrawal(state, meta["postBalances"][0], debit)
                with Path(".local/wallet-transfers.jsonl").open("a") as log:
                    log.write(json.dumps(plan | {"signature": signature, "confirmed_at": time.time()})+"\n")
                PENDING.unlink()
                print("Transfer confirmed: "+signature+". New buys remain paused; existing daily stop state is preserved.")
                return
            time.sleep(2)
        raise ExecutionUncertain("Confirmation timeout; check the pending signature on-chain, do not blindly retry")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        raise SystemExit("Wallet action stopped. Check setup, RPC, open positions and pending journals. No automatic retry; credentials are not printed.")
