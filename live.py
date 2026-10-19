"""Opt-in Jupiter execution. Requires USDC funding, SOL fees and a local signer."""
import argparse
import base64
import copy
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

import bot

USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"


class ExecutionUncertain(RuntimeError):
    pass


def request(url, payload=None, headers=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def save(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2))
    os.replace(temporary, path)


class Executor:
    def __init__(self, journal):
        from solders.keypair import Keypair
        self.rpc_url = os.environ["SOLANA_RPC_URL"]
        if not self.rpc_url.startswith("https://"):
            raise ValueError("SOLANA_RPC_URL must use HTTPS")
        self.api_key = os.environ["JUPITER_API_KEY"]
        keypath = Path(os.environ["SOLANA_KEYPAIR_PATH"]).resolve()
        if keypath.is_relative_to(Path(__file__).resolve().parent):
            raise ValueError("Keep the signer outside the repository")
        if keypath.stat().st_mode & 0o077:
            raise ValueError("Signer file permissions must be 0600")
        self.key = Keypair.from_bytes(bytes(json.loads(keypath.read_text())))
        self.owner = str(self.key.pubkey())
        self.journal = journal
        if journal.exists():
            raise ExecutionUncertain("Pending execution journal exists; reconcile chain fills and ledger before restarting")

    def rpc(self, method, params):
        response = request(self.rpc_url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        if "error" in response:
            raise RuntimeError("RPC rejected " + method)
        return response["result"]

    def token_balance(self, mint):
        result = self.rpc("getTokenAccountsByOwner", [self.owner, {"mint": mint}, {"encoding": "jsonParsed", "commitment": "confirmed"}])
        return sum(int(x["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) for x in result["value"])

    def trade(self, mint, buy, amount):
        from solders.transaction import VersionedTransaction
        from solders.message import to_bytes_versioned
        input_mint, output_mint = (USDC, mint) if buy else (mint, USDC)
        headers = {"x-api-key": self.api_key}
        query = urllib.parse.urlencode(dict(inputMint=input_mint, outputMint=output_mint,
                                           amount=amount, slippageBps=100, restrictIntermediateTokens="true"))
        quote = request("https://api.jup.ag/swap/v1/quote?" + query, headers=headers)
        if (quote.get("inputMint") != input_mint or quote.get("outputMint") != output_mint
                or int(quote.get("inAmount", 0)) != amount or int(quote.get("outAmount", 0)) <= 0):
            raise RuntimeError("Invalid quote")
        if float(quote.get("priceImpactPct", 100)) > 0.02:
            raise RuntimeError("Quote price impact exceeds 2%")
        swap = request("https://api.jup.ag/swap/v1/swap", dict(quoteResponse=quote,
                       userPublicKey=self.owner, dynamicComputeUnitLimit=True,
                       prioritizationFeeLamports=10000), headers)
        tx = VersionedTransaction.from_bytes(base64.b64decode(swap["swapTransaction"]))
        if tx.message.header.num_required_signatures != 1 or str(tx.message.account_keys[0]) != self.owner:
            raise RuntimeError("Unexpected transaction signer")
        signed = VersionedTransaction.populate(tx.message, [self.key.sign_message(to_bytes_versioned(tx.message))])
        signature = str(signed.signatures[0])
        # Persist BEFORE sending. An ambiguous network failure must never cause a duplicate trade.
        save(self.journal, dict(signature=signature, mint=mint, buy=buy, amount=amount, time=time.time()))
        self.rpc("sendTransaction", [base64.b64encode(bytes(signed)).decode(),
                                   {"encoding": "base64", "skipPreflight": False, "maxRetries": 2}])
        for _ in range(60):
            result = self.rpc("getTransaction", [signature, {"encoding": "jsonParsed", "commitment": "confirmed", "maxSupportedTransactionVersion": 0}])
            if result:
                meta = result["meta"]
                if meta["err"]:
                    raise ExecutionUncertain("Transaction failed; inspect journal and fee before restarting")
                def balances(key, target):
                    entries = [x for x in meta[key] if x.get("owner") == self.owner and x["mint"] == target]
                    return sum(int(x["uiTokenAmount"]["amount"]) for x in entries)
                token_delta = balances("postTokenBalances", mint) - balances("preTokenBalances", mint)
                usd_delta = (balances("postTokenBalances", USDC) - balances("preTokenBalances", USDC)) / 1e6
                entries = [x for x in meta["postTokenBalances"] + meta["preTokenBalances"] if x["mint"] == mint and x.get("owner") == self.owner]
                decimals = entries[0]["uiTokenAmount"]["decimals"] if entries else 0
                if (buy and (token_delta <= 0 or usd_delta >= 0)) or (not buy and (token_delta >= 0 or usd_delta <= 0)):
                    raise ExecutionUncertain("Unexpected fill deltas; manual reconciliation required")
                return dict(raw_delta=token_delta, quantity=token_delta / 10**decimals,
                            usd_delta=usd_delta, signature=signature, sol_fee=meta["fee"] / 1e9)
            time.sleep(2)
        raise ExecutionUncertain("Confirmation timed out; reconcile journal before restarting")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--acknowledge-live-risk", action="store_true")
    parser.add_argument("--daily-loss-usd", type=float, required=True)
    args = parser.parse_args()
    if not args.acknowledge_live_risk or not 0 < args.daily_loss_usd < 100:
        parser.error("Explicit live acknowledgement and a daily loss limit above $0 and below $100 are required")
    c = bot.validate(bot.DEFAULTS | json.loads(Path("config.json").read_text()))
    # Jupiter only executes Solana routes; never feed EVM addresses to it.
    c.update(chains=["solana"], pump_only=True, watchlist=[t for t in c["watchlist"] if t["chain"] == "solana"])
    c.update(capital=100.0, daily_loss_fraction=args.daily_loss_usd / 100)
    path = Path(".local/live-state.json")
    path.parent.mkdir(exist_ok=True)
    import fcntl
    lock = open(".local/live.lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    executor = Executor(Path(".local/pending-trade.json"))
    if executor.rpc("getGenesisHash", []) != "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d":
        raise RuntimeError("Expected Solana mainnet")
    state = json.loads(path.read_text()) if path.exists() else dict(cash=100.0, positions={}, traded=[], cost=0.03)
    if state.get("wallet", executor.owner) != executor.owner:
        raise RuntimeError("Live ledger belongs to a different wallet")
    state["wallet"] = executor.owner
    for mint, position in state["positions"].items():
        if executor.token_balance(mint) < position["raw_amount"]:
            raise RuntimeError("Wallet token balance differs from ledger; reconcile before restarting")
    if executor.token_balance(USDC) < round(state["cash"] * 1e6):
        raise RuntimeError("Wallet needs at least the ledger's USDC cash balance; initial budget is 100 USDC")
    if executor.rpc("getBalance", [executor.owner, {"commitment": "confirmed"}])["value"] < 10000000:
        raise RuntimeError("Wallet requires at least 0.01 SOL separately for transaction fees")
    save(path, state)
    while True:
        try:
            candidates = bot.scan(state, c)
        except (OSError, ValueError, KeyError, TypeError):
            bot.publish(path.with_suffix(".dashboard.json"), dict(time=time.time(), mode="live-solana", events=[], candidates=[],
                        error="Live monitoring stopped: market feed failed. Check open positions manually."), state, c)
            raise SystemExit("Market feed failed; live monitoring stopped")
        proposed = copy.deepcopy(state)
        events = bot.step(proposed, candidates, c, time.time())
        # Market marks and the daily stop are durable even if no trade executes.
        for name in ("day", "day_equity", "halted"):
            state[name] = proposed[name]
        for address, position in state["positions"].items():
            if address in proposed["positions"]:
                position.update(high=proposed["positions"][address]["high"], last_price=proposed["positions"][address]["last_price"])
        save(path, state)
        for event in events:
            if event["event"] not in ("buy", "sell"):
                print(json.dumps(event), flush=True)
                continue
            address = event["address"]
            buy = event["event"] == "buy"
            amount = int(event["spent"] * 1e6) if buy else state["positions"][address]["raw_amount"]
            try:
                fill = executor.trade(address, buy, amount)
            except (OSError, ValueError, KeyError, RuntimeError):
                bot.publish(path.with_suffix(".dashboard.json"), dict(time=time.time(), mode="live-solana", events=[], candidates=candidates,
                            error="Live execution stopped. Reconcile any pending journal before restarting; positions may remain open."), state, c)
                raise SystemExit("Live execution stopped; reconcile the pending journal and wallet before restarting")
            state["cash"] += fill["usd_delta"]
            if buy:
                candidate = next(x for x in candidates if x["address"] == address)
                pair = candidate["pair"]
                entry = -fill["usd_delta"] / fill["quantity"]
                state["positions"][address] = dict(quantity=fill["quantity"], raw_amount=fill["raw_delta"],
                    spent=-fill["usd_delta"], entry=entry, high=entry, last_price=entry, opened=time.time(), pair=pair,
                    chain="solana", token_address=address, symbol=candidate.get("symbol", address))
            else:
                if -fill["raw_delta"] != amount:
                    raise ExecutionUncertain("Partial sell; reconcile journal and ledger")
                del state["positions"][address]
                state["traded"].append(address)
            save(path, state)
            # A crash between ledger save and journal deletion requires manual reconciliation.
            executor.journal.unlink()
            with Path(".local/live-fills.jsonl").open("a") as log:
                log.write(json.dumps(event | fill) + "\n")
            print(json.dumps(event | fill), flush=True)
            bot.publish(path.with_suffix(".dashboard.json"), dict(time=time.time(), mode="live-solana", events=[event | fill],
                        candidates=candidates, halted=state["halted"], equity=bot.equity(state, {})), state, c)
        bot.publish(path.with_suffix(".dashboard.json"), dict(time=time.time(), mode="live-solana", events=[e for e in events if e["event"] == "stale_price"],
                    candidates=candidates, halted=state["halted"], equity=bot.equity(state, {})), state, c)
        time.sleep(c["interval_seconds"])


if __name__ == "__main__":
    main()
