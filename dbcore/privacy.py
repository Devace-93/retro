"""IP hashing. retro never stores a raw IP address.

``ip_hash(ip)`` = sha256(ip + ":" + daily_salt) where
``daily_salt`` = sha256(IP_HASH_SECRET + ":" + YYYY-MM-DD). The salt rotates
every UTC day, so a hash can only ever be correlated within one day — enough
for ingest rate limits and "one vote per address per day" de-duplication, and
useless for tracking people across time.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from .config import config


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def daily_salt(day: str | None = None) -> str:
    return hashlib.sha256(f"{config.ip_hash_secret}:{day or _today()}".encode()).hexdigest()


def ip_hash(ip: str | None) -> str | None:
    """Daily-salted sha256 hex digest of ``ip`` (None for a missing address)."""
    if not ip:
        return None
    return hashlib.sha256(f"{ip}:{daily_salt()}".encode()).hexdigest()
