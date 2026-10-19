"""Multi-chain market research and persistent paper trading. No wallet support."""
import argparse
import json
import math
import os
import time
import urllib.request
import urllib.parse
from pathlib import Path

from callouts import publish

API = "https://api.dexscreener.com"
DEFAULTS = dict(capital=1000.0, position_fraction=0.02, daily_loss_fraction=0.02,
                max_positions=3, min_liquidity=50000, min_age_minutes=30,
                max_age_hours=48, min_volume_5m=10000, min_buys_5m=30,
                min_buy_sell_ratio=1.5, max_change_5m=35, stop_fraction=0.10,
                take_profit_fraction=0.30, trailing_fraction=0.15,
                fee_fraction=0.01, slippage_fraction=0.02, interval_seconds=60,
                max_hold_hours=6, narrative_keywords=[], chains=["solana"],
                pump_only=True, watchlist=[])

SUPPORTED_CHAINS = {"solana", "ethereum", "base", "bsc", "arbitrum", "polygon", "avalanche", "optimism"}


def market_key(chain, address):
    # Preserve existing Solana ledgers while isolating identical EVM addresses.
    return address if chain == "solana" else f"{chain}:{address.lower()}"


def get(path):
    request = urllib.request.Request(API + path, headers={"User-Agent": "snorbingdep-paper/0.1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else 0.0
    except (ValueError, TypeError):
        return 0.0


def validate(c):
    for key, default in DEFAULTS.items():
        if isinstance(default, (int, float)) and not isinstance(default, bool):
            if isinstance(c[key], bool) or not isinstance(c[key], (int, float)) or not math.isfinite(c[key]) or c[key] <= 0:
                raise ValueError(f"{key} must be a positive finite number")
    for key in ("position_fraction", "daily_loss_fraction", "stop_fraction", "take_profit_fraction", "trailing_fraction", "fee_fraction", "slippage_fraction"):
        if c[key] >= 1:
            raise ValueError(f"{key} must be below 1")
    if not isinstance(c["max_positions"], int):
        raise ValueError("max_positions must be an integer")
    if not isinstance(c["narrative_keywords"], list) or not all(isinstance(x, str) for x in c["narrative_keywords"]):
        raise ValueError("narrative_keywords must be a list of strings")
    if not isinstance(c["chains"], list) or not c["chains"] or any(x not in SUPPORTED_CHAINS for x in c["chains"]):
        raise ValueError("chains must contain supported DexScreener chain IDs")
    if not isinstance(c["pump_only"], bool):
        raise ValueError("pump_only must be boolean")
    if not isinstance(c["watchlist"], list):
        raise ValueError("watchlist must be a list")
    for token in c["watchlist"]:
        if not isinstance(token, dict) or token.get("chain") not in c["chains"] or not isinstance(token.get("address"), str) or not token["address"].isalnum():
            raise ValueError("watchlist entries require an enabled chain and alphanumeric token address")
    return c


def assess(pair, c, now):
    token = pair.get("baseToken", {})
    age = (now - number(pair.get("pairCreatedAt")) / 1000) / 60
    tx = pair.get("txns", {}).get("m5", {})
    buys, sells = number(tx.get("buys")), number(tx.get("sells"))
    liq = number(pair.get("liquidity", {}).get("usd"))
    volume = number(pair.get("volume", {}).get("m5"))
    try:
        change = float(pair.get("priceChange", {}).get("m5", 0))
    except (TypeError, ValueError):
        change = float("nan")
    checks = {
        "chain_enabled": pair.get("chainId") in c["chains"],
        "pump_filter": not c["pump_only"] or (pair.get("chainId") == "solana" and str(token.get("address", "")).endswith("pump")),
        "price": number(pair.get("priceUsd")) > 0,
        "age": c["min_age_minutes"] <= age <= c["max_age_hours"] * 60,
        "liquidity": liq >= c["min_liquidity"],
        "volume": volume >= c["min_volume_5m"],
        "buys": buys >= c["min_buys_5m"],
        "buy_pressure": buys / max(sells, 1) >= c["min_buy_sell_ratio"],
        "momentum": math.isfinite(change) and 0 < change <= c["max_change_5m"],
    }
    text = (token.get("name", "") + " " + token.get("symbol", "")).lower()
    matches = [k for k in c["narrative_keywords"] if k.lower() in text]
    score = round(min(buys / max(sells, 1), 5) * 10 + min(volume / max(liq, 1), 2) * 20, 2)
    return dict(address=market_key(pair.get("chainId"), str(token.get("address", ""))),
                token_address=token.get("address"), chain=pair.get("chainId"),
                symbol=token.get("symbol"), price=number(pair.get("priceUsd")),
                score=score, eligible=all(checks.values()), checks=checks,
                keyword_matches=matches, pair=pair.get("pairAddress"))


def equity(state, prices):
    # Charge estimated liquidation costs even while positions remain open.
    return state["cash"] + sum(p["quantity"] * prices.get(a, p["last_price"]) * (1 - state["cost"])
                                for a, p in state["positions"].items())


def step(state, candidates, c, now):
    prices = {x["address"]: x["price"] for x in candidates if x["price"] > 0}
    events = []
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    if state.get("day") != day:
        state.update(day=day, day_equity=equity(state, prices), halted=False)
    if equity(state, prices) <= state["day_equity"] * (1 - c["daily_loss_fraction"]):
        state["halted"] = True
    for address, p in list(state["positions"].items()):
        if address not in prices:
            events.append(dict(event="stale_price", address=address))
            continue
        price = prices[address]
        p["last_price"] = price
        p["high"] = max(p["high"], price)
        reason = ("daily_limit" if state["halted"] else
                  "stop" if price <= p["entry"] * (1 - c["stop_fraction"]) else
                  "trailing" if price <= p["high"] * (1 - c["trailing_fraction"]) else
                  "take_profit" if price >= p["entry"] * (1 + c["take_profit_fraction"]) else
                  "time" if now - p["opened"] >= c["max_hold_hours"] * 3600 else None)
        if reason:
            proceeds = p["quantity"] * price * (1 - state["cost"])
            state["cash"] += proceeds
            events.append(dict(event="sell", address=address, reason=reason, pnl=proceeds-p["spent"]))
            del state["positions"][address]
            state["traded"].append(address)
    for x in sorted(candidates, key=lambda x: x["score"], reverse=True):
        if any(address not in prices for address in state["positions"]):
            break
        if state["halted"] or len(state["positions"]) >= c["max_positions"]:
            break
        address = x["address"]
        if not x["eligible"] or address in state["positions"] or address in state["traded"]:
            continue
        spend = min(state["cash"], equity(state, prices) * c["position_fraction"])
        if spend <= 0:
            break
        quantity = spend / (x["price"] * (1 + state["cost"]))
        state["cash"] -= spend
        state["positions"][address] = dict(quantity=quantity, spent=spend, entry=x["price"],
                                          chain=x.get("chain", "solana"), symbol=x.get("symbol", address),
                                          token_address=x.get("token_address", address), pair=x.get("pair"),
                                          high=x["price"], last_price=x["price"], opened=now)
        events.append(dict(event="buy", address=address, spent=spend))
    return events


def scan(state, c):
    profiles = get("/token-profiles/latest/v1")
    addresses = {(p["chainId"], p["tokenAddress"]) for p in profiles
                 if p.get("chainId") in c["chains"] and str(p.get("tokenAddress", "")).isalnum()
                 and (not c["pump_only"] or (p["chainId"] == "solana" and p["tokenAddress"].endswith("pump")))}
    addresses.update((t["chain"], t["address"]) for t in c["watchlist"])
    addresses.update((p.get("chain", "solana"), p.get("token_address", a)) for a, p in state["positions"].items())
    output = []
    addresses = {market_key(chain, address): (chain, address) for chain, address in sorted(addresses)}
    for chain, address in addresses.values():
        pairs = get(f"/token-pairs/v1/{urllib.parse.quote(chain, safe='')}/{urllib.parse.quote(address, safe='')}")
        pairs = [p for p in pairs if p.get("chainId") == chain and
                 market_key(chain, str(p.get("baseToken", {}).get("address", ""))) == market_key(chain, address)]
        # Keep the same market for held positions to avoid switching price sources.
        held = state["positions"].get(market_key(chain, address))
        if held:
            pairs = [p for p in pairs if p.get("pairAddress") == held.get("pair")]
        if pairs:
            pair = max(pairs, key=lambda p: number(p.get("liquidity", {}).get("usd")))
            output.append(assess(pair, c, time.time()))
        time.sleep(0.25)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--state", default=".local/state.json")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    c = validate(DEFAULTS | json.loads(Path(args.config).read_text()))
    path = Path(args.state)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Single writer prevents concurrent loops from corrupting the paper ledger.
    import fcntl
    with open(str(path) + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(path.read_text()) if path.exists() else dict(
            cash=c["capital"], positions={}, traded=[], cost=c["fee_fraction"]+c["slippage_fraction"])
        if state["cost"] != c["fee_fraction"] + c["slippage_fraction"]:
            raise ValueError("Use a new --state path when changing trading costs")
        while True:
            try:
                candidates = scan(state, c)
                events = step(state, candidates, c, time.time())
                for x in candidates:
                    if x["address"] in state["positions"]:
                        state["positions"][x["address"]]["pair"] = x["pair"]
                temporary = path.with_suffix(".tmp")
                temporary.write_text(json.dumps(state, indent=2))
                os.replace(temporary, path)
                report = dict(time=time.time(), mode="paper", equity=equity(state, {}),
                              halted=state["halted"], events=events, candidates=candidates)
                with path.with_suffix(".jsonl").open("a") as log:
                    log.write(json.dumps(report) + "\n")
                publish(path.with_suffix(".dashboard.json"), report, state, c)
                print(json.dumps(report), flush=True)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                publish(path.with_suffix(".dashboard.json"), dict(time=time.time(), mode="paper", error="Market scan failed; no new trades this cycle", events=[], candidates=[]), state, c)
                print(json.dumps(dict(error=str(exc), action="no new trades this cycle")), flush=True)
                if args.once:
                    raise
            if args.once:
                break
            time.sleep(c["interval_seconds"])


if __name__ == "__main__":
    main()
