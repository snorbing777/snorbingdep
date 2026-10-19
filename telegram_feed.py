"""Read posts delivered to your authorized dedicated Telegram bot. Sends no messages."""
import argparse
import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

from live import save
from social_feed import MINT, merge, settings


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def api(method, data):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("Configure TELEGRAM_BOT_TOKEN securely")
    request = urllib.request.Request("https://api.telegram.org/bot"+token+"/"+method,
           data=json.dumps(data).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
        raw = response.read(2097153)
    if len(raw) > 2097152:
        raise ValueError("Telegram response too large")
    result = json.loads(raw)
    if result.get("ok") is not True:
        raise RuntimeError("Telegram access unavailable")
    return result["result"]


def photo(file_id):
    identifier = hashlib.sha256(file_id.encode()).hexdigest()
    path = Path(".local/telegram-media")/(identifier+".jpg")
    if path.exists():
        return "/api/community-image?id="+identifier
    info = api("getFile", {"file_id": file_id})
    file_path = info.get("file_path", "")
    if not file_path or file_path.startswith("/") or ".." in file_path.split("/"):
        return None
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = "https://api.telegram.org/file/bot"+token+"/"+urllib.parse.quote(file_path, safe="/")
    with urllib.request.build_opener(NoRedirect()).open(url, timeout=15) as response:
        data = response.read(2097153)
    if len(data) > 2097152 or not data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")):
        return None
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(data)
    # Bound the local thumbnail cache; never touch wallets or trading state.
    files = sorted(path.parent.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    for old in files[:-200]:
        old.unlink()
    return "/api/community-image?id="+identifier


def normalize(updates, username, photo_loader=photo):
    output = []
    for update in updates:
        post = update.get("channel_post") or update.get("edited_channel_post")
        if not post or post.get("chat", {}).get("username", "").lower() != username.lower():
            continue
        text = str(post.get("text") or post.get("caption") or "")[:5000]
        image = None
        if post.get("photo"):
            try:
                image = photo_loader(post["photo"][-1]["file_id"])
            except (OSError, ValueError, RuntimeError, KeyError):
                pass
        for mint in (list(dict.fromkeys(MINT.findall(text))) or [None])[:5]:
            output.append({"id": f"telegram:{post['chat']['id']}:{post['message_id']}:{mint}", "mint": mint,
                          "author": post["chat"].get("title", username), "username": username, "source": "Telegram",
                          "text": text, "time": post["date"], "image": image,
                          "source_url": f"https://t.me/{username}/{post['message_id']}"})
    return output


def collect(once=False):
    cursor = Path(".local/telegram-cursor.json")
    try:
        offset = json.loads(cursor.read_text())["offset"]
    except (OSError, ValueError, KeyError):
        offset = 0
    updates = api("getUpdates", {"offset": offset, "limit": 100, "timeout": 0 if once else 20,
                                "allowed_updates": ["channel_post", "edited_channel_post"]})
    username = settings()["telegram_username"]
    items = normalize(updates, username)
    merge(items, f"Telegram collector active for @{username}. Only posts the bot is authorized to receive can appear; channel access is not established by an empty response.")
    if updates:
        save(cursor, {"offset": max(u["update_id"] for u in updates)+1})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    while True:
        try:
            collect(args.once)
            print("Telegram collector checked authorized updates; no message or trade sent", flush=True)
        except (OSError, ValueError, RuntimeError, KeyError, TypeError):
            raise SystemExit("Telegram unavailable. Configure a dedicated bot token securely and obtain channel permission; no access bypass or messages were attempted.")
        if args.once:
            return
        time.sleep(1)


if __name__ == "__main__":
    main()
