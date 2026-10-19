"""Conservative gates on supplied social measurements, never return forecasts."""
import json
import math
from pathlib import Path

EVIDENCE = Path(".local/narrative-evidence.json")


def review(mint, evidence, now):
    item = evidence.get(mint, {})
    def numeric(key):
        value = item.get(key)
        return float(value) if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) else -1
    if not item:
        return False, "No narrative measurements"
    if not isinstance(item.get("narrative"), str) or not item["narrative"].strip():
        return False, "Narrative not identified"
    if not 0 <= now-numeric("observed_at") <= 300:
        return False, "Narrative measurements stale"
    if item.get("sample_complete") is not True or not item.get("sources"):
        return False, "Incomplete social sample or missing sources"
    current, previous, authors, engagements = (numeric(k) for k in ("mentions_5m", "previous_mentions_5m", "unique_authors_5m", "engagements_5m"))
    if min(current, previous, authors, engagements) < 0 or authors > current:
        return False, "Invalid social measurements"
    if current < 30 or authors < 20 or engagements < 100 or current/max(previous, 1) < 2.5:
        return False, "Narrative activity below configured thresholds"
    return True, "Fresh social measurements pass; returns and authenticity unverified"


def enforce(candidates, config, now, path=EVIDENCE):
    if not config.get("require_narrative"):
        return candidates
    try:
        evidence = json.loads(path.read_text())
        if not isinstance(evidence, dict):
            evidence = {}
    except (OSError, ValueError):
        evidence = {}
    output = []
    for token in candidates:
        approved, reason = review(token.get("token_address", token["address"]), evidence, now)
        output.append(token | {"eligible": token["eligible"] and approved,
                     "checks": token.get("checks", {}) | {"narrative_evidence": approved},
                     "narrative_reason": reason})
    return output
