"""Password verification and exact HTTPS origin checks for optional public sharing."""
import base64
import hashlib
import hmac
import json
import os
import re
import threading
from pathlib import Path
from urllib.parse import urlsplit


def origin(value):
    url = urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443) or url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("Use an exact HTTPS origin")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}", url.hostname):
        raise ValueError("Invalid public hostname")
    return "https://"+url.hostname.lower()


def password_config(password):
    if not isinstance(password, str) or len(password) < 16:
        raise ValueError("Choose a new dashboard password of at least 16 characters")
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return {"username": "signaldesk", "salt": salt.hex(), "digest": digest.hex()}


class Password:
    def __init__(self, config):
        self.config = config
        self.salt = bytes.fromhex(config["salt"])
        self.digest = bytes.fromhex(config["digest"])
        if config["username"] != "signaldesk" or len(self.salt) != 16 or len(self.digest) != 32:
            raise ValueError("Invalid access configuration")
        self.accepted = set()
        self.slots = threading.BoundedSemaphore(2)

    def check(self, authorization):
        if not isinstance(authorization, str) or len(authorization) > 4096 or not authorization.startswith("Basic "):
            return False
        fingerprint = hashlib.sha256(authorization.encode()).digest()
        if fingerprint in self.accepted:
            return True
        if not self.slots.acquire(blocking=False):
            return False
        try:
            user, password = base64.b64decode(authorization[6:], validate=True).decode().split(":", 1)
            digest = hashlib.pbkdf2_hmac("sha256", password.encode(), self.salt, 200_000)
            valid = hmac.compare_digest(user.encode(), self.config["username"].encode()) and hmac.compare_digest(digest, self.digest)
        except (ValueError, UnicodeError):
            return False
        finally:
            self.slots.release()
        if valid:
            if len(self.accepted) >= 16:
                self.accepted.clear()
            self.accepted.add(fingerprint)
        return valid


def load(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("Sharing access file must be a regular private file (0600)")
    return Password(json.loads(path.read_text()))
