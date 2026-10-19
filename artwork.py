"""Restricted public-gateway artwork resolver. Never fetch arbitrary local URLs."""
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HOSTS = {"ipfs.io", "gateway.pinata.cloud", "pump.mypinata.cloud", "arweave.net", "images.pump.fun", "cdn.dexscreener.com", "dd.dexscreener.com", "pbs.twimg.com"}
MINT = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
CACHE, LOCK = {}, threading.Lock()
SLOTS = threading.BoundedSemaphore(6)


def safe_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("Invalid artwork URL")
    if value.startswith("ipfs://"):
        value = "https://ipfs.io/ipfs/" + value[7:].removeprefix("ipfs/")
    if value.startswith("ar://"):
        value = "https://arweave.net/" + value[5:]
    url = urllib.parse.urlsplit(value)
    if url.scheme != "https" or url.username or url.password or url.port not in (None, 443) or not (
        url.hostname in HOSTS or (url.hostname or "").endswith(".ipfs.dweb.link")
    ):
        raise ValueError("Unsupported artwork host")
    return value


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def candidates(url):
    url = safe_url(url)
    parsed = urllib.parse.urlsplit(url)
    if parsed.path.startswith("/ipfs/"):
        return list(dict.fromkeys([url, "https://ipfs.io" + parsed.path, "https://gateway.pinata.cloud" + parsed.path]))
    return [url]


def fetch(url, max_size):
    request = urllib.request.Request(safe_url(url), headers={"User-Agent": "SignalDesk/1.0", "Accept": "application/json,image/*"})
    opener = urllib.request.build_opener(Redirects())
    with opener.open(request, timeout=4) as response:
        safe_url(response.url)
        body = response.read(max_size+1)
        if len(body) > max_size:
            raise ValueError("Artwork response too large")
        return body, response.headers.get_content_type()


def resolve(mint, uri):
    if not MINT.fullmatch(mint):
        raise ValueError("Invalid mint")
    key = (mint, uri)
    with LOCK:
        cached = CACHE.get(key)
        if cached and time.time()-cached[0] < (1800 if cached[1].get("image") else 30):
            return cached[1]
    result = {"image": None, "status": "metadata_unavailable"}
    try:
        urls = candidates(uri) if uri else []
    except ValueError:
        urls = []
    for url in urls[:2]:
        try:
            body, kind = fetch(url, 262144)
            if body.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a")) or (body[:4] == b"RIFF" and body[8:12] == b"WEBP"):
                result = {"image": url, "status": "ready"}
                break
            data = json.loads(body)
            image = data.get("image") or data.get("image_uri")
            if image:
                image = safe_url(image) if image.startswith(("ipfs://", "ar://")) else image
                parsed = urllib.parse.urlsplit(image)
                if parsed.scheme != "https" or parsed.username or parsed.password:
                    continue
                result = {"image": image, "status": "ready"}
                break
        except (OSError, ValueError, TypeError, AttributeError):
            continue
    if not result["image"]:
        try:
            # Indexed-market fallback; brand-new unindexed launches may have no entry.
            req = urllib.request.Request("https://api.dexscreener.com/token-pairs/v1/solana/"+mint,
                                         headers={"User-Agent": "SignalDesk/1.0"})
            with urllib.request.urlopen(req, timeout=3) as response:
                raw = response.read(524289)
            if len(raw) <= 524288:
                pairs = json.loads(raw)
                image = next((p.get("info", {}).get("imageUrl") for p in pairs if p.get("baseToken", {}).get("address") == mint and p.get("info", {}).get("imageUrl")), None)
                if image:
                    result = {"image": image, "status": "indexed_fallback"}
        except (OSError, ValueError, TypeError, AttributeError):
            pass
    with LOCK:
        if len(CACHE) >= 1200:
            CACHE.pop(next(iter(CACHE)))
        CACHE[key] = (time.time(), result)
    return result


def image_bytes(url):
    for candidate in candidates(url):
        try:
            body, kind = fetch(candidate, 2097152)
            # Serve raster images only from the proxy; creator HTML/SVG never executes locally.
            if body.startswith(b"\x89PNG\r\n\x1a\n"):
                return body, "image/png"
            if body.startswith(b"\xff\xd8\xff"):
                return body, "image/jpeg"
            if body.startswith((b"GIF87a", b"GIF89a")):
                return body, "image/gif"
            if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
                return body, "image/webp"
        except (OSError, ValueError):
            continue
    raise ValueError("Raster image unavailable")
