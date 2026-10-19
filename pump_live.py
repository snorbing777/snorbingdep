"""Unattended Solana pump-token trading with a separate LOCAL trading wallet."""
import argparse
import base64
import copy
import json
import os
import socket
import ssl
import time
import urllib.request
import urllib.error
from pathlib import Path

import bot
import spending
import narrative
from live import Executor, ExecutionUncertain, save
from wallet_setup import DEFAULT_WALLET, load_wallet

WSOL = "So11111111111111111111111111111111111111112"
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"


class EntryPaused(RuntimeError):
    pass


def sol_usd():
    pairs = bot.get(f"/token-pairs/v1/solana/{WSOL}")
    usable = [p for p in pairs if p.get("chainId") == "solana" and
              p.get("baseToken", {}).get("address") == WSOL and bot.number(p.get("priceUsd")) > 0
              and bot.number(p.get("liquidity", {}).get("usd")) >= 1000000]
    if not usable:
        raise RuntimeError("No sufficiently liquid SOL/USD reference quote")
    return float(max(usable, key=lambda p: bot.number(p["liquidity"]["usd"]))["priceUsd"])


def token_amount(account, owner, mint=None):
    if account is None:
        return 0
    if account.get("owner") not in (TOKEN_PROGRAM, TOKEN_2022):
        raise RuntimeError("Unexpected token account program")
    from solders.pubkey import Pubkey
    data = base64.b64decode(account["data"][0], validate=True)
    if len(data) < 165 or str(Pubkey.from_bytes(data[32:64])) != owner:
        raise RuntimeError("Invalid token account owner")
    if mint and str(Pubkey.from_bytes(data[:32])) != mint:
        raise RuntimeError("Unexpected token account mint")
    return int.from_bytes(data[64:72], "little")


class PumpExecutor(Executor):
    def __init__(self, wallet, journal):
        self.rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
        if not self.rpc_url.startswith("https://"):
            raise ValueError("Use an HTTPS mainnet RPC")
        self.key = load_wallet(wallet)
        self.owner = str(self.key.pubkey())
        self.journal = journal
        if journal.exists() or Path(".local/withdraw-pending.json").exists():
            raise ExecutionUncertain("Pending trade exists. Reconcile its signature and ledger before restarting")

    def sol_balance(self):
        options = {"commitment": "confirmed"}
        if getattr(self, "min_slot", None):
            options["minContextSlot"] = self.min_slot
        return self.rpc("getBalance", [self.owner, options])["value"]

    def simulate(self, tx, mint, buy, amount, max_debit_lamports=None):
        from solders.pubkey import Pubkey
        mint_info = self.rpc("getAccountInfo", [mint, {"encoding": "base64", "commitment": "confirmed"}])["value"]
        if not mint_info or mint_info["owner"] not in (TOKEN_PROGRAM, TOKEN_2022):
            raise RuntimeError("Unsupported mint program")
        accounts = {}
        for program in (TOKEN_PROGRAM, TOKEN_2022):
            result = self.rpc("getTokenAccountsByOwner", [self.owner, {"programId": program}, {"encoding": "base64", "commitment": "confirmed"}])
            for item in result["value"]:
                accounts[item["pubkey"]] = item["account"]
        ata = str(Pubkey.find_program_address([bytes(self.key.pubkey()), bytes(Pubkey.from_string(mint_info["owner"])),
                    bytes(Pubkey.from_string(mint))], Pubkey.from_string(ATA_PROGRAM))[0])
        if ata not in accounts:
            accounts[ata] = None
        if len(accounts) > 99:
            raise RuntimeError("Too many token accounts for guarded simulation; use a dedicated wallet")
        addresses = [self.owner, *accounts]
        before_sol = self.sol_balance()
        if getattr(self, "expected_balance_lamports", before_sol) != before_sol:
            raise RuntimeError("Wallet balance changed during trade preparation")
        result = self.rpc("simulateTransaction", [base64.b64encode(bytes(tx)).decode(),
            {"encoding": "base64", "sigVerify": False, "commitment": "confirmed",
             "accounts": {"encoding": "base64", "addresses": addresses}}])["value"]
        if result.get("err") or not result.get("accounts") or len(result["accounts"]) != len(addresses):
            raise RuntimeError("Transaction simulation failed")
        after = result["accounts"]
        wallet = after[0]
        if not wallet or wallet.get("owner") != "11111111111111111111111111111111" or wallet.get("executable"):
            raise RuntimeError("Unexpected wallet account change")
        if base64.b64decode(wallet.get("data", [""])[0]):
            raise RuntimeError("Unexpected wallet account data")
        sol_delta = wallet["lamports"] - before_sol
        if buy:
            spending.verify_simulated_debit(before_sol, wallet["lamports"], max_debit_lamports)
        # Allows bounded rent/network overhead; this is not a guaranteed fee quote.
        if buy and (sol_delta >= 0 or -sol_delta > amount + 5000000):
            raise RuntimeError("Simulated SOL debit exceeds requested amount plus 0.005 SOL overhead")
        if not buy and sol_delta <= 0:
            raise RuntimeError("Sell simulation does not return SOL")
        desired_before = desired_after = 0
        for (address, previous), current in zip(accounts.items(), after[1:]):
            previous_amount = token_amount(previous, self.owner)
            current_amount = token_amount(current, self.owner)
            previous_data = base64.b64decode(previous["data"][0]) if previous else b""
            current_data = base64.b64decode(current["data"][0]) if current else b""
            old_mint = str(Pubkey.from_bytes(previous_data[:32])) if previous_data else None
            new_mint = str(Pubkey.from_bytes(current_data[:32])) if current_data else None
            if old_mint and new_mint and old_mint != new_mint:
                raise RuntimeError("Token account mint changed")
            if current_data:
                if current_data[72:108] != (previous_data[72:108] if previous_data else bytes(36)):
                    raise RuntimeError("Token delegate authority changed")
                if current_data[121:165] != (previous_data[121:165] if previous_data else bytes(44)):
                    raise RuntimeError("Token delegation or close authority changed")
            target = (old_mint or new_mint) == mint
            if previous_amount > current_amount and (buy or not target):
                raise RuntimeError("Simulation would debit an unrelated token balance")
            if target:
                desired_before += previous_amount
                desired_after += current_amount
        if buy and desired_after <= desired_before:
            raise RuntimeError("Buy simulation does not deliver target tokens")
        if not buy and desired_before - desired_after != amount:
            raise RuntimeError("Sell simulation does not match the tracked position")

    def trade(self, mint, buy, amount, max_debit_lamports=None):
        started = time.perf_counter()
        from solders.pubkey import Pubkey
        from solders.transaction import VersionedTransaction
        from solders.message import to_bytes_versioned
        Pubkey.from_string(mint)
        if not isinstance(amount, int) or amount <= 0:
            raise ValueError("Trade amount must be positive integer base units")
        if buy and (not isinstance(max_debit_lamports, int) or max_debit_lamports < amount or max_debit_lamports > amount+spending.MAX_OVERHEAD):
            raise ValueError("A bounded total SOL debit allowance is required for every entry")
        if buy and Path(".local/PAUSE_BUYS").exists():
            raise EntryPaused("New entries are paused")
        if not buy and self.token_balance(mint) != amount:
            raise RuntimeError("Token balance changed outside the bot; reconcile before selling")
        payload = dict(publicKey=self.owner, action="buy" if buy else "sell", mint=mint,
                       amount=amount / 1e9 if buy else "100%", denominatedInSol="true" if buy else "false",
                       slippage=1, priorityFee=0.00001, pool="auto")
        request = urllib.request.Request("https://pumpportal.fun/api/trade-local", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=25) as response:
            raw = response.read(4097)
        if len(raw) > 4096:
            raise RuntimeError("Oversized transaction response")
        tx = VersionedTransaction.from_bytes(raw)
        built = time.perf_counter()
        if tx.message.header.num_required_signatures != 1 or str(tx.message.account_keys[0]) != self.owner:
            raise RuntimeError("Unexpected transaction signer")
        self.simulate(tx, mint, buy, amount, max_debit_lamports)
        simulated = time.perf_counter()
        if buy and Path(".local/PAUSE_BUYS").exists():
            raise EntryPaused("New entries paused before signing")
        signed = VersionedTransaction.populate(tx.message, [self.key.sign_message(to_bytes_versioned(tx.message))])
        signature = str(signed.signatures[0])
        save(self.journal, dict(signature=signature, mint=mint, buy=buy, amount=amount, max_debit_lamports=max_debit_lamports, time=time.time()))
        self.rpc("sendTransaction", [base64.b64encode(bytes(signed)).decode(),
                 {"encoding": "base64", "skipPreflight": False, "maxRetries": 2}])
        sent = time.perf_counter()
        for _ in range(60):
            transaction = self.rpc("getTransaction", [signature, {"encoding": "jsonParsed", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}])
            if transaction:
                meta = transaction["meta"]
                if meta["err"]:
                    raise ExecutionUncertain("Transaction failed; reconcile fee and journal")
                def total(name):
                    entries = [x for x in meta[name] if x.get("owner") == self.owner and x["mint"] == mint]
                    return sum(int(x["uiTokenAmount"]["amount"]) for x in entries)
                delta = total("postTokenBalances") - total("preTokenBalances")
                sol_delta = (meta["postBalances"][0]-meta["preBalances"][0])/1e9
                if buy:
                    spending.verify_simulated_debit(meta["preBalances"][0], meta["postBalances"][0], max_debit_lamports)
                entries = [x for x in meta["postTokenBalances"] + meta["preTokenBalances"] if x.get("owner") == self.owner and x["mint"] == mint]
                if (buy and (delta <= 0 or sol_delta >= 0 or -sol_delta*1e9 > amount+5000000)) or (not buy and (delta != -amount or sol_delta <= 0)):
                    raise ExecutionUncertain("Unexpected confirmed fill; reconcile journal and balances")
                self.min_slot = transaction.get("slot")
                return dict(signature=signature, raw_delta=delta,
                            timing_ms={"build": round((built-started)*1000), "simulation": round((simulated-built)*1000),
                                       "broadcast": round((sent-simulated)*1000), "confirmation": round((time.perf_counter()-sent)*1000)},
                            quantity=delta/10**entries[0]["uiTokenAmount"]["decimals"], sol_delta=sol_delta,
                            sol_delta_lamports=meta["postBalances"][0]-meta["preBalances"][0],
                            sol_fee=meta["fee"]/1e9)
            time.sleep(2)
        raise ExecutionUncertain("Confirmation timed out; do not retry without reconciling the journal")


def run(args):
    import fcntl
    c = bot.validate(bot.DEFAULTS | json.loads(Path("config.json").read_text()))
    c.update(capital=100.0, daily_loss_fraction=.15, chains=["solana"], pump_only=True, watchlist=[], require_narrative=True)
    path = Path(".local/pump-live-state.json")
    path.parent.mkdir(exist_ok=True)
    with path.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        executor = PumpExecutor(args.wallet, Path(".local/pump-pending-trade.json"))
        if executor.rpc("getGenesisHash", []) != MAINNET:
            raise RuntimeError("Expected Solana mainnet")
        sol_price = sol_usd()
        balance = executor.sol_balance()/1e9
        state = json.loads(path.read_text()) if path.exists() else dict(
            cash_sol=min(balance, 100/sol_price), positions={}, traded=[], cost=.03, wallet=executor.owner)
        if "wallet_balance_lamports" not in state and (state["positions"] or state["traded"]):
            raise RuntimeError("Older ledger with trading history needs manual funding reconciliation before upgrading")
        if state["wallet"] != executor.owner:
            raise RuntimeError("Ledger belongs to a different wallet")
        if balance < state["cash_sol"] or balance < .01:
            raise RuntimeError("Wallet balance is insufficient or changed; fund at least 0.01 SOL")
        spending.reconcile(state, round(balance*1e9))
        for mint, position in state["positions"].items():
            if executor.token_balance(mint) != position["raw_amount"]:
                raise RuntimeError("Token balances differ from ledger; reconcile before running")
        state["cash"] = state["cash_sol"]*sol_price
        save(path, state)
        print("REAL TRADING ENABLED · Solana mainnet · public wallet " + executor.owner, flush=True)
        print("Budget capped at $100 at initialization; daily $15 stop trigger; fees/rent reduce tracked SOL cash.", flush=True)
        print("Fresh narrative measurements are required for new buys. Missing evidence blocks entry; exits remain active.", flush=True)
        try:
            while True:
                spending.reconcile(state, executor.sol_balance())
                sol_price = sol_usd()
                state["cash"] = state["cash_sol"]*sol_price
                candidates = narrative.enforce(bot.scan(state, c), c, time.time())
                proposed = copy.deepcopy(state)
                today = time.strftime("%Y-%m-%d", time.gmtime())
                if state.get("day") != today:
                    state["daily_buy_debits_usd"] = 0.0
                reference = state.get("day_equity", 100) if state.get("day") == today else bot.equity(state, {x["address"]: x["price"] for x in candidates})
                # Fixed dollar stop where equity exceeds $15; below that, halt before spending the last cash.
                c["daily_loss_fraction"] = min(.99, 15/max(reference, .01))
                events = bot.step(proposed, candidates, c, time.time())
                for name in ("day", "day_equity", "halted"):
                    state[name] = proposed[name]
                for address, p in state["positions"].items():
                    candidate = next((x for x in candidates if x["address"] == address), None)
                    if candidate:
                        p["last_price"] = candidate["price"]
                        p["high"] = max(p["high"], candidate["price"])
                save(path, state)
                publish(path, state, candidates, c, [])
                for event in events:
                    if event["event"] not in ("buy", "sell"):
                        continue
                    address, buy = event["address"], event["event"] == "buy"
                    if buy:
                        candidate = next(x for x in candidates if x["address"] == address)
                        if not narrative.enforce([candidate], c, time.time())[0]["eligible"]:
                            continue
                        current_equity = bot.equity(state, {})
                        if state["halted"] or current_equity <= state["day_equity"]-15:
                            state["halted"] = True
                            continue
                        usd = min(event["spent"], current_equity*c["position_fraction"])
                        amount, max_debit = spending.entry_budget(state, sol_price, usd, paused=Path(".local/PAUSE_BUYS").exists())
                        if amount <= 0:
                            continue
                    else:
                        amount = state["positions"][address]["raw_amount"]
                        max_debit = None
                    spending.reconcile(state, executor.sol_balance())
                    executor.expected_balance_lamports = state["wallet_balance_lamports"]
                    if buy and Path(".local/PAUSE_BUYS").exists():
                        continue
                    try:
                        fill = executor.trade(address, buy, amount, max_debit_lamports=max_debit)
                    except EntryPaused:
                        continue
                    delta_lamports = fill.get("sol_delta_lamports", round(fill["sol_delta"]*1e9))
                    state["wallet_balance_lamports"] += delta_lamports
                    state["cash_sol"] = (round(state["cash_sol"]*1e9)+delta_lamports)/1e9
                    state["cash"] = state["cash_sol"]*sol_price
                    state["last_execution_timing_ms"] = fill.get("timing_ms")
                    if buy:
                        candidate = next(x for x in candidates if x["address"] == address)
                        spent = -fill["sol_delta"]*sol_price
                        state["daily_buy_debits_usd"] = state.get("daily_buy_debits_usd", 0)+spent
                        entry = spent/fill["quantity"]
                        state["positions"][address] = dict(quantity=fill["quantity"], raw_amount=fill["raw_delta"],
                            spent=spent, entry=entry, high=entry, last_price=candidate["price"], opened=time.time(),
                            pair=candidate["pair"], symbol=candidate.get("symbol"), chain="solana", token_address=address)
                    else:
                        fill["realized_pnl_usd"] = fill["sol_delta"]*sol_price-state["positions"][address]["spent"]
                        del state["positions"][address]
                        state["traded"].append(address)
                    save(path, state)
                    executor.journal.unlink()
                    fill["usd_delta"] = fill["sol_delta"]*sol_price
                    fill["quote_sol_usd"] = sol_price
                    with Path(".local/pump-live-fills.jsonl").open("a") as log:
                        log.write(json.dumps(event | fill)+"\n")
                    publish(path, state, candidates, c, [event | fill])
                    print(json.dumps(event | fill), flush=True)
                publish(path, state, candidates, c, [e for e in events if e["event"] == "stale_price"])
                time.sleep(c["interval_seconds"])
        except (OSError, ValueError, RuntimeError, KeyError, TypeError):
            publish(path, state, [], c, [], "LIVE BOT STOPPED. Inspect open positions and reconcile any pending trade before restarting.")
            raise SystemExit("Live trading stopped. Check RPC/provider connectivity, open positions and pending journal. No automatic retry.")


def publish(path, state, candidates, config, events, error=None):
    # The displayed threshold stays $15 even when the daily equity fraction changes.
    report = dict(time=time.time(), mode="live-pump", equity=bot.equity(state, {}),
                  halted=state.get("halted", False), candidates=candidates, events=events, error=error)
    bot.publish(path.with_suffix(".dashboard.json"), report, state, config | dict(daily_loss_fraction=.15))


def check_failure(stage, exc):
    # Do not print exception URLs/messages: RPC URLs can contain API credentials.
    if isinstance(exc, ExecutionUncertain):
        reason = "A pending trade journal exists. Reconcile it on-chain; do not delete it blindly."
    elif isinstance(exc, ImportError):
        reason = "A Python dependency is missing. Run Set Up Mac.command."
    elif stage == "wallet loading":
        safe_messages = {"Wallet must be a regular local file", "Keep the wallet outside the project folder", "Wallet file must have permissions 0600"}
        reason = str(exc) if str(exc) in safe_messages else "The wallet file is missing, unreadable or invalid."
        reason += " Run wallet_setup.py --address to inspect setup; never print the wallet file."
    elif isinstance(exc, urllib.error.HTTPError):
        reason = f"The service returned HTTP {exc.code}."
        if exc.code == 429:
            reason += " Rate limit reached; wait or configure a dedicated HTTPS mainnet RPC if this is an RPC step."
        elif exc.code in (401, 403):
            reason += " Access was denied; check the service credentials and network restrictions."
    elif isinstance(exc, (urllib.error.URLError, TimeoutError, OSError)):
        cause = exc.reason if isinstance(exc, urllib.error.URLError) else exc
        if isinstance(cause, ssl.SSLCertVerificationError):
            reason = "TLS certificate verification failed. For python.org macOS installs, run the matching Python Install Certificates.command; keep TLS verification enabled."
        elif isinstance(cause, socket.gaierror):
            reason = "DNS lookup failed. Check the configured RPC hostname and your internet/DNS connection."
        elif isinstance(cause, (TimeoutError, socket.timeout)):
            reason = "Connection timed out. Check reachability or use a reachable HTTPS mainnet RPC."
        elif isinstance(cause, ConnectionRefusedError):
            reason = "Connection refused. Check the configured service and local network/proxy settings."
        elif isinstance(cause, ssl.SSLError):
            reason = "TLS handshake failed. Check Python/OpenSSL and network/proxy trust configuration; keep certificate verification enabled."
        else:
            reason = "Connection failed (" + type(cause).__name__ + "). Check connectivity and configured network/proxy settings."
    elif stage == "Solana network verification":
        reason = "The RPC returned an error, an unexpected response or the wrong network. Use Solana mainnet."
    elif stage == "SOL/USD reference feed":
        reason = "The price feed failed or returned no qualifying liquid SOL/USD market."
    else:
        reason = "The RPC could not return a valid wallet balance."
    return f"Read-only check failed at {stage}: {reason} No trade was submitted."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wallet", type=Path, default=DEFAULT_WALLET)
    parser.add_argument("--acknowledge-live-risk", action="store_true")
    parser.add_argument("--check", action="store_true", help="Check wallet/RPC/reference price without building or submitting a trade")
    args = parser.parse_args()
    if args.check:
        stage = "wallet loading"
        try:
            executor = PumpExecutor(args.wallet, Path(".local/pump-pending-trade.json"))
            stage = "Solana network verification"
            if executor.rpc("getGenesisHash", []) != MAINNET:
                raise RuntimeError("Wrong chain")
            stage = "SOL/USD reference feed"
            price = sol_usd()
            stage = "wallet balance lookup"
            balance = executor.sol_balance()/1e9
            print(json.dumps(dict(wallet=executor.owner, network="Solana mainnet", balance_sol=balance,
                approximate_balance_usd=balance*price, budget_usd=min(100,balance*price),
                minimum_funding_present=balance >= .01, reserve_sol=spending.RESERVE/1e9,
                max_entry_total_usd=spending.MAX_ENTRY_USD, max_open_exposure_usd=spending.MAX_EXPOSURE_USD,
                deposit_arrival_verified=False,
                narrative_evidence_file_present=narrative.EVIDENCE.exists(),
                entry_policy="Fresh measured narrative activity required; no runner or profit guarantee",
                daily_stop_usd=15, trade_submitted=False, funded_trade_execution_verified=False)))
            return
        except (OSError, ValueError, RuntimeError, KeyError, TypeError, ImportError) as exc:
            raise SystemExit(check_failure(stage, exc)) from None
    if not args.acknowledge_live_risk:
        parser.error("This spends real SOL. Explicit --acknowledge-live-risk is required")
    try:
        run(args)
    except (OSError, ValueError, RuntimeError, KeyError):
        raise SystemExit("Startup failed. Check wallet file, RPC, funding and provider access; no credentials are printed.")


if __name__ == "__main__":
    main()
