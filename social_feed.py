"""Official X API callouts and measured topic activity. No scraping or trading."""
import argparse
import datetime as dt
import json
import os
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from live import save

FEED = Path(".local/community-callouts.json")
MINT = re.compile(r"(?<![1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])")


def settings():
    return json.loads(Path(__file__).with_name("social_settings.json").read_text())


def public_feed():
    try:
        data = json.loads(FEED.read_text())
        items = data.get("items", [])[-200:]
    except (OSError, ValueError):
        data, items = {}, []
    return {"items": items, "updated_at": data.get("updated_at"),
            "status": data.get("status", "X API not connected. No community callouts have been fetched."),
            "sources": settings(), "profitability_verified": False}


def merge(items, status, metadata=None):
    import fcntl
    FEED.parent.mkdir(exist_ok=True)
    with Path(".local/community-callouts.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            old = json.loads(FEED.read_text())
        except (OSError, ValueError):
            old = {}
        combined = {p["id"]: p for p in old.get("items", [])}
        combined.update({p["id"]: p for p in items})
        save(FEED, old | (metadata or {}) | {"items": sorted(combined.values(), key=lambda p: p["time"])[-200:],
              "updated_at": time.time(), "status": status})


def get(path, query):
    token = os.environ.get("X_BEARER_TOKEN")
    if not token:
        raise RuntimeError("X_BEARER_TOKEN is missing; configure it securely")
    request = urllib.request.Request("https://api.x.com/2/"+path+"?"+urllib.parse.urlencode(query),
                                     headers={"Authorization": "Bearer "+token, "User-Agent": "SignalDesk/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read(2097153)
    if len(raw) > 2097152:
        raise ValueError("API response too large")
    result = json.loads(raw)
    if result.get("errors") or result.get("error"):
        raise RuntimeError("X API returned errors")
    return result


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def normalize(result):
    users = {u["id"]: u for u in result.get("includes", {}).get("users", [])}
    media = {m["media_key"]: m for m in result.get("includes", {}).get("media", [])}
    items = []
    for post in result.get("data", []):
        user = users.get(post.get("author_id"), {})
        username = user.get("username")
        if not username or not re.fullmatch(r"[A-Za-z0-9_]{1,15}", username) or not str(post.get("id", "")).isdigit():
            continue
        text = str(post.get("text", ""))[:5000]
        mints = list(dict.fromkeys(MINT.findall(text))) or [None]
        photos = [media[k].get("url") or media[k].get("preview_image_url") for k in post.get("attachments", {}).get("media_keys", []) if k in media]
        for mint in mints[:5]:
            items.append({"id": post["id"]+":"+str(mint), "mint": mint, "author": user.get("name", username),
                          "username": username, "author_id": user.get("id"), "text": text,
                          "time": timestamp(post["created_at"]), "source_url": "https://x.com/"+username+"/status/"+post["id"],
                          "image": next((x for x in photos if x), None), "avatar": user.get("profile_image_url"),
                          "source": "X", "metrics": post.get("public_metrics", {})})
    return items


def collect():
    names = settings()["x_usernames"]
    if not names or any(not re.fullmatch(r"[A-Za-z0-9_]{1,15}", n) for n in names):
        raise ValueError("Configure valid X usernames")
    try:
        previous = json.loads(FEED.read_text())
    except (OSError, ValueError):
        previous = {}
    query = {"query": "("+" OR ".join("from:"+n for n in names)+") -is:retweet", "max_results": 100,
             "tweet.fields": "created_at,public_metrics,attachments,author_id", "expansions": "author_id,attachments.media_keys",
             "user.fields": "name,username,profile_image_url", "media.fields": "url,preview_image_url,type"}
    if previous.get("since_id"):
        query["since_id"] = previous["since_id"]
    result = get("tweets/search/recent", query)
    merge(normalize(result), "Official X API connected. Posts are unverified opinions, not profitable-trade records.",
          {"since_id": result.get("meta", {}).get("newest_id", previous.get("since_id"))})


def measure_topics():
    path = Path("narrative_topics.json")
    if not path.exists():
        return
    topics = json.loads(path.read_text())
    if not isinstance(topics, dict) or len(topics) > 5:
        raise ValueError("Configure at most 5 mint/topic pairs per measurement cycle")
    now = time.time()
    evidence = {}
    for mint, topic in topics.items():
        if not MINT.fullmatch(mint) or not isinstance(topic, str) or not 3 <= len(topic) <= 80 or any(c in topic for c in '\\"\n\r'):
            raise ValueError("Invalid mint/topic configuration")
        result = get("tweets/search/recent", {"query": f'({mint} OR "{topic}") -is:retweet', "max_results": 100,
             "start_time": dt.datetime.fromtimestamp(now-600, dt.timezone.utc).isoformat().replace("+00:00", "Z"),
             "tweet.fields": "created_at,public_metrics,author_id"})
        current, previous = [], []
        for post in result.get("data", []):
            observed = timestamp(post["created_at"])
            if now-300 <= observed <= now:
                current.append(post)
            elif now-600 <= observed < now-300:
                previous.append(post)
        evidence[mint] = {"narrative": topic, "observed_at": now, "sample_complete": not bool(result.get("meta", {}).get("next_token")),
            "mentions_5m": len(current), "previous_mentions_5m": len(previous),
            "unique_authors_5m": len({p.get("author_id") for p in current if p.get("author_id")}),
            "engagements_5m": sum(sum(p.get("public_metrics", {}).get(k, 0) for k in ("like_count", "retweet_count", "reply_count", "quote_count")) for p in current),
            "sources": ["https://api.x.com/2/tweets/search/recent"], "measurement_type": "sampled X topic discussion; bots and authenticity unverified"}
    Path(".local").mkdir(exist_ok=True)
    save(Path(".local/narrative-evidence.json"), evidence)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--measure-topics", action="store_true", help="Also query explicitly configured narrative_topics.json; uses API quota")
    args = parser.parse_args()
    while True:
        try:
            collect()
            if args.measure_topics:
                measure_topics()
            print("X callout feed updated; no trade submitted", flush=True)
        except (OSError, RuntimeError, ValueError, KeyError, TypeError):
            Path(".local").mkdir(exist_ok=True)
            data = public_feed()
            save(FEED, {"items": data["items"], "updated_at": data["updated_at"],
                        "status": "X feed unavailable. Check X_BEARER_TOKEN, account handles, API entitlement and network access. Existing posts may be stale."})
            raise SystemExit("X data unavailable. No credentials printed and no trades submitted.")
        if args.once:
            return
        time.sleep(60)


if __name__ == "__main__":
    main()
