"""Restricted public-gateway artwork resolver. Never fetch arbitrary local URLs."""
import base64
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HOSTS = {"ipfs.io", "gateway.pinata.cloud", "pump.mypinata.cloud", "arweave.net", "images.pump.fun", "cdn.dexscreener.com", "dd.dexscreener.com", "pbs.twimg.com", "dweb.link"}
MINT = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
CACHE, LOCK = {}, threading.Lock()
SLOTS = threading.BoundedSemaphore(6)
IMAGE_SLOTS = threading.BoundedSemaphore(8)
IMAGE_CACHE, IMAGE_ERRORS = {}, {}
METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"


def safe_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("Invalid artwork URL")
    if value.startswith("ipfs://"):
        value = "https://ipfs.io/ipfs/" + value[7:].removeprefix("ipfs/")
    if value.startswith("ar://"):
        value = "https://arweave.net/" + value[5:]
    # Creators use many IPFS gateways. Extract only a valid CID/path and fetch
    # through our fixed gateways instead of requesting an arbitrary host.
    parsed = urllib.parse.urlsplit(value)
    subdomain = re.match(r"^((?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120}))\.ipfs\.", parsed.hostname or "")
    if subdomain and parsed.scheme in ("http", "https") and not parsed.username and not parsed.password:
        value = "https://ipfs.io/ipfs/"+subdomain[1]+parsed.path
        parsed = urllib.parse.urlsplit(value)
    match = re.match(r"^/ipfs/((?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120}))(?:/|$)", parsed.path)
    if match and parsed.scheme in ("http", "https") and parsed.hostname not in HOSTS and not parsed.username and not parsed.password:
        value = "https://ipfs.io"+parsed.path
    elif parsed.scheme == "http" and parsed.hostname in HOSTS and parsed.path.startswith("/ipfs/") and parsed.port in (None, 80) and not parsed.username and not parsed.password:
        value = urllib.parse.urlunsplit(("https", parsed.hostname, parsed.path, parsed.query, ""))
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


def failure(exc):
    if isinstance(exc, urllib.error.HTTPError):
        return "http_"+str(exc.code)
    import ssl
    cause = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    if isinstance(cause, ssl.SSLCertVerificationError):
        return "tls_certificate_failed"
    if isinstance(cause, TimeoutError):
        return "timeout"
    if isinstance(exc, (ValueError, TypeError, KeyError, AttributeError)):
        return "invalid_or_unsupported_metadata"
    return "connection_failed"


def read_json(url, payload=None):
    request = urllib.request.Request(url, data=json.dumps(payload).encode() if payload else None,
        headers={"User-Agent": "SignalDesk/2.0", "Accept": "application/json", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=3) as response:
        raw = response.read(524289)
    if len(raw) > 524288:
        raise ValueError("Metadata too large")
    return json.loads(raw)


def chain_uri(mint):
    from solders.pubkey import Pubkey
    rpc = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
    if not rpc.startswith("https://"):
        raise ValueError("HTTPS required")
    def account(address, encoding):
        return read_json(rpc, {"jsonrpc": "2.0", "id": 1, "method": "getAccountInfo",
            "params": [address, {"encoding": encoding, "commitment": "confirmed"}]})["result"]["value"]
    public = Pubkey.from_string(mint)
    info = account(mint, "jsonParsed")
    if info:
        for extension in info.get("data", {}).get("parsed", {}).get("info", {}).get("extensions", []):
            if extension.get("extension") == "tokenMetadata" and extension.get("state", {}).get("uri"):
                return extension["state"]["uri"].strip("\x00 ")
    program = Pubkey.from_string(METAPLEX)
    address = str(Pubkey.find_program_address([b"metadata", bytes(program), bytes(public)], program)[0])
    data = account(address, "base64")
    if not data or data.get("owner") != METAPLEX:
        return None
    raw = base64.b64decode(data["data"][0], validate=True)
    if len(raw) < 65 or raw[0] != 4 or raw[33:65] != bytes(public):
        raise ValueError("Wrong metadata account")
    offset, fields = 65, []
    for _ in range(3):
        size = int.from_bytes(raw[offset:offset+4], "little"); offset += 4
        if size > 5000 or offset+size > len(raw):
            raise ValueError("Invalid metadata field")
        fields.append(raw[offset:offset+size].decode().strip("\x00 ")); offset += size
    return fields[2] or None


def image_field(data, source):
    image = next((data.get(k) for k in ("image", "image_uri", "imageUri", "image_url", "imageUrl") if data.get(k)), None)
    if isinstance(image, dict):
        image = image.get("url")
    if not isinstance(image, str) or len(image) > 2048:
        return None
    image = urllib.parse.urljoin(source, image) if not image.startswith(("ipfs://", "ar://")) else image
    if image.startswith(("ipfs://", "ar://")):
        return safe_url(image)
    if urllib.parse.urlsplit(image).hostname in HOSTS:
        image = safe_url(image)
    url = urllib.parse.urlsplit(image)
    host = url.hostname or ""
    if url.scheme != "https" or url.username or url.password or url.port not in (None, 443) or "." not in host or ":" in host or host.endswith((".local", ".internal")) or re.fullmatch(r"[0-9.]+", host):
        return None
    return image


def fetch(url, max_size):
    request = urllib.request.Request(safe_url(url), headers={"User-Agent": "SignalDesk/1.0", "Accept": "application/json,image/*"})
    opener = urllib.request.build_opener(Redirects())
    with opener.open(request, timeout=4) as response:
        safe_url(response.url)
        body = response.read(max_size+1)
        if len(body) > max_size:
            raise ValueError("Artwork response too large")
        return body, response.headers.get_content_type()


def resolve(mint, uri, force=False):
    if not MINT.fullmatch(mint):
        raise ValueError("Invalid mint")
    key = (mint, uri)
    with LOCK:
        cached = CACHE.get(key)
        if not force and cached and time.time()-cached[0] < (1800 if cached[1].get("image") else 30):
            return cached[1]
    result = {"image": None, "status": "metadata_unavailable", "attempts": [], "stream_uri_present": bool(uri)}
    def metadata(source):
        try:
            urls = candidates(source) if source else []
        except ValueError:
            result["attempts"].append({"stage": "Metadata host", "status": "unsupported_host"})
            return
        for url in urls[:2]:
            try:
                body, _ = fetch(url, 262144)
                image = url if raster_type(body) else image_field(json.loads(body), url)
                if image:
                    result.update(image=image, status="ready")
                    result["attempts"].append({"stage": "Token metadata", "status": "image_found"})
                    return
                result["attempts"].append({"stage": "Token metadata", "status": "image_field_missing"})
            except (OSError, ValueError, TypeError, AttributeError) as exc:
                result["attempts"].append({"stage": "Token metadata", "status": failure(exc)})
    metadata(uri)
    if not result["image"]:
        try:
            data = read_json("https://frontend-api-v3.pump.fun/coins/"+mint)
            if data.get("mint") != mint:
                raise ValueError("Wrong mint")
            image = image_field(data, "https://pump.fun/")
            result["attempts"].append({"stage": "Pump.fun coin metadata", "status": "image_found" if image else "no_image"})
            if image:
                result.update(image=image, status="pump_metadata")
            else:
                metadata(data.get("metadata_uri") or data.get("uri"))
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            result["attempts"].append({"stage": "Pump.fun coin metadata", "status": failure(exc)})
    if not result["image"]:
        try:
            discovered = chain_uri(mint)
            result["attempts"].append({"stage": "Solana on-chain metadata", "status": "uri_found" if discovered else "no_uri"})
            if discovered and discovered != uri:
                metadata(discovered)
        except (OSError, ValueError, TypeError, KeyError, AttributeError, ImportError) as exc:
            result["attempts"].append({"stage": "Solana on-chain metadata", "status": failure(exc)})
    if not result["image"]:
        try:
            # Indexed-market fallback; brand-new unindexed launches may have no entry.
            pairs = read_json("https://api.dexscreener.com/token-pairs/v1/solana/"+mint)
            image = next((p.get("info", {}).get("imageUrl") for p in pairs if p.get("baseToken", {}).get("address") == mint and p.get("info", {}).get("imageUrl")), None)
            if image:
                result.update(image=image, status="indexed_fallback")
            result["attempts"].append({"stage": "DexScreener", "status": "image_found" if image else "not_indexed_or_no_image"})
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            result["attempts"].append({"stage": "DexScreener", "status": failure(exc)})
    with LOCK:
        if len(CACHE) >= 1200:
            CACHE.pop(next(iter(CACHE)))
        CACHE[key] = (time.time(), result)
    return result


def raster_type(body):
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "image/webp"
    if body[4:8] == b"ftyp" and any(brand in body[8:32] for brand in (b"avif", b"avis")):
        return "image/avif"
    return None


def image_bytes(url):
    url = safe_url(url)
    with LOCK:
        cached = IMAGE_CACHE.get(url)
        if cached and time.time()-cached[0] < 1800:
            return cached[1:]
    for candidate in candidates(url):
        try:
            body, kind = fetch(candidate, 2097152)
            # Serve raster images only from the proxy; creator HTML/SVG never executes locally.
            kind = raster_type(body)
            if kind:
                with LOCK:
                    IMAGE_CACHE[url] = (time.time(), body, kind)
                    while len(IMAGE_CACHE) > 512 or sum(len(entry[1]) for entry in IMAGE_CACHE.values()) > 64*1024*1024:
                        IMAGE_CACHE.pop(next(iter(IMAGE_CACHE)))
                    IMAGE_ERRORS.pop(url, None)
                return body, kind
            with LOCK:
                IMAGE_ERRORS[url] = "unsupported_or_invalid_image_bytes"
        except (OSError, ValueError) as exc:
            with LOCK:
                IMAGE_ERRORS[url] = failure(exc)
                if len(IMAGE_ERRORS) > 1200:
                    IMAGE_ERRORS.pop(next(iter(IMAGE_ERRORS)))
            continue
    raise ValueError("Raster image unavailable")
