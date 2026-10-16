"""Cloudflare Turnstile verification (Phase 2, optional per project).

:func:`verify` returns ``True`` (valid), ``False`` (invalid / missing) or
``None`` when Cloudflare could not be reached: the caller accepts the
submission in that case and tags it ``unverified`` — feedback is never lost
because a third party is down.
"""
from __future__ import annotations

import json
import logging
from urllib import error, parse, request

from .config import config

log = logging.getLogger("retro.turnstile")

TIMEOUT_SECONDS = 5


def verify(secret: str, token: str | None, remote_ip: str | None = None) -> bool | None:
    if not token:
        return False
    body = {"secret": secret, "response": token}
    if remote_ip:
        body["remoteip"] = remote_ip
    req = request.Request(
        config.turnstile_verify_url,
        data=parse.urlencode(body).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "retro/1"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode() or "{}")
    except (error.URLError, OSError, ValueError) as err:
        log.warning("turnstile verification unavailable: %s", err)
        return None
    return bool(data.get("success"))
