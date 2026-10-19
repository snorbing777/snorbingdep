"""Read-only, source-labelled research for a requested Solana mint."""
import json
import threading
import time
from pathlib import Path

import bot
import narrative
from artwork import MINT

CACHE = {}
LOCK = threading.Lock()
SLOTS = threading.BoundedSemaphore(2)


def analyze(mint, now=None):
    if not MINT.fullmatch(mint):
        raise ValueError("Invalid mint")
    now = time.time() if now is None else now
    with LOCK:
        cached = CACHE.get(mint)
        if cached and now-cached[0] < 30:
            return cached[1]
    config = bot.validate(bot.DEFAULTS | json.loads(Path(__file__).with_name("config.json").read_text()))
    config.update(chains=["solana"], pump_only=False, require_narrative=True)
    try:
        evidence = json.loads(narrative.EVIDENCE.read_text())
        if not isinstance(evidence, dict):
            evidence = {}
    except (OSError, ValueError):
        evidence = {}
    if not isinstance(evidence.get(mint, {}), dict):
        evidence.pop(mint, None)
    approved, reason = narrative.review(mint, evidence, now)
    item = evidence.get(mint, {})
    social = {k: item.get(k) for k in ("narrative", "observed_at", "sample_complete", "mentions_5m",
              "previous_mentions_5m", "unique_authors_5m", "engagements_5m", "sources")}
    result = dict(mint=mint, observed_at=now, status="insufficient_data", eligible=False,
                  narrative=social | {"passed": approved, "reason": reason}, checks={}, metrics={},
                  score=None, score_label="Market activity score · not return probability",
                  unknowns=["Creator intent and coordinated promotion", "Holder concentration and LP control",
                            "Future liquidity, execution and returns"],
                  sources=["https://api.dexscreener.com/token-pairs/v1/solana/"+mint])
    try:
        pairs = bot.get("/token-pairs/v1/solana/"+mint)
        pairs = [p for p in pairs if p.get("chainId") == "solana" and p.get("baseToken", {}).get("address") == mint]
        if pairs:
            pair = max(pairs, key=lambda p: bot.number(p.get("liquidity", {}).get("usd")))
            assessed = bot.assess(pair, config, now)
            tx = pair.get("txns", {}).get("m5", {})
            metrics = dict(price_usd=assessed["price"], liquidity_usd=bot.number(pair.get("liquidity", {}).get("usd")),
                           market_age_minutes=(now-bot.number(pair.get("pairCreatedAt"))/1000)/60,
                           volume_5m_usd=bot.number(pair.get("volume", {}).get("m5")),
                           buys_5m=bot.number(tx.get("buys")), sells_5m=bot.number(tx.get("sells")),
                           market_cap_usd=bot.number(pair.get("marketCap")) or None,
                           fdv_usd=bot.number(pair.get("fdv")) or None)
            # A scenario is arithmetic at constant supply, never a forecast or target.
            cap = metrics["market_cap_usd"]
            result.update(metrics=metrics, checks=assessed["checks"] | {"narrative_evidence": approved},
                          score=assessed["score"], eligible=assessed["eligible"] and approved,
                          scenario_100x_cap_usd=cap*100 if cap else None,
                          status="screen_passed" if assessed["eligible"] and approved else "screen_blocked")
        else:
            result["reason"] = "No indexed market yet. Bonding-curve launches can be absent from DexScreener; market checks are unknown."
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        result["reason"] = "Market provider unavailable or returned invalid data. Screening is blocked until fresh data is available."
    result["thresholds"] = {k: config[k] for k in ("min_age_minutes", "max_age_hours", "min_liquidity",
                                                  "min_volume_5m", "min_buys_5m", "min_buy_sell_ratio", "max_change_5m")}
    with LOCK:
        if len(CACHE) >= 1000:
            CACHE.pop(next(iter(CACHE)))
        CACHE[mint] = (now, result)
    return result
