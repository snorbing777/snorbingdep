"""Public dashboard snapshots and deduplicated, persistent callouts."""
import hashlib
import json
import os
from pathlib import Path


def publish(path, report, state, config):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    previous = json.loads(path.read_text()) if path.exists() else {}
    now = report["time"]
    alerts = previous.get("alerts", [])[-100:]
    cooldowns = previous.get("cooldowns", {})
    candidates = {x["address"]: x for x in report.get("candidates", [])}

    def add(kind, title, detail, identity, cooldown=0):
        key = hashlib.sha256(identity.encode()).hexdigest()[:24]
        if key in cooldowns and now - cooldowns[key] < cooldown:
            return
        cooldowns[key] = now
        alerts.append(dict(id=f"{key}-{now}", time=now, kind=kind, title=title, detail=detail))

    mode = report.get("mode", "paper")
    for event in report.get("events", []):
        address = event["address"]
        token = candidates.get(address, state["positions"].get(address, {}))
        symbol = token.get("symbol") or address
        chain = token.get("chain", "solana")
        if event["event"] == "buy":
            amount = event.get("spent", 0) if mode == "paper" else -event.get("usd_delta", 0)
            add("entry", f"{'PAPER ENTRY' if mode == 'paper' else 'LIVE BUY CONFIRMED'} · {symbol}",
                f"{chain} · ${amount:.2f} · {address}", f"buy:{address}:{event.get('signature', now)}")
        elif event["event"] == "sell":
            reason = event.get("reason", "exit").replace("_", " ")
            # Proposed paper P&L is never presented as a confirmed live fill.
            detail = f"{chain} · {reason} · "
            if mode == "paper":
                detail += f"simulated P&L ${event.get('pnl', 0):+.2f}"
            elif mode == "live-pump":
                detail += f"received {event.get('sol_delta', 0):.6f} SOL (~${event.get('usd_delta', 0):.2f})"
            else:
                detail += f"received ${event.get('usd_delta', 0):.2f} USDC"
            add("exit", f"{'PAPER EXIT' if mode == 'paper' else 'LIVE SELL CONFIRMED'} · {symbol}", detail,
                f"sell:{address}:{event.get('signature', now)}")
        elif event["event"] == "stale_price":
            add("warning", f"PRICE UNAVAILABLE · {symbol}", "Position remains open. New entries are blocked.", f"stale:{address}", 600)
    if report.get("error"):
        add("warning", "DATA FEED ERROR", report["error"], "feed-error", 300)
    if report.get("halted"):
        add("warning", "DAILY STOP ACTIVE", "New entries halted; exits depend on available quotes and execution.", "daily-stop:"+state.get("day", ""), 86400)
    for token in candidates.values():
        if token["eligible"] and not report.get("error") and not report.get("halted"):
            add("watch", f"WATCH · {token.get('symbol') or token['address']}",
                f"{token.get('chain', 'solana')} · momentum score {token['score']:.1f} · screening passed; not a buy instruction",
                "watch:"+token["address"], 900)
    public = dict(time=now, mode=mode, error=report.get("error"), halted=report.get("halted", state.get("halted", False)),
                  execution_timing_ms=state.get("last_execution_timing_ms"),
                  equity=report.get("equity"), cash=state["cash"], capital=config["capital"],
                  daily_loss_usd=config["capital"]*config["daily_loss_fraction"],
                  interval_seconds=config["interval_seconds"], chains=config["chains"],
                  positions=[dict(address=a, **{k: p.get(k) for k in ("symbol", "chain", "entry", "last_price", "spent")})
                             for a, p in state["positions"].items()],
                  candidates=list(candidates.values()), alerts=alerts[-100:],
                  cooldowns={k: v for k, v in cooldowns.items() if now-v < 86400})
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(public))
    os.replace(temporary, path)


def public_snapshot(path):
    if not path.exists():
        return dict(time=0, mode="waiting", alerts=[], candidates=[], positions=[])
    data = json.loads(path.read_text())
    data.pop("cooldowns", None)
    return data
