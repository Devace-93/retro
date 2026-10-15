"""Environment-driven configuration. No secrets in code."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    # database / cache
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://retro:retro@localhost:5432/retro",
    )
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # auth
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "dev-insecure-change-me")
    access_token_ttl_min: int = int(os.getenv("ACCESS_TOKEN_TTL_MIN", "30"))
    refresh_token_ttl_days: int = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "30"))

    # urls
    app_base_url: str = os.getenv("APP_BASE_URL", "http://localhost:8082")
    dashboard_url: str = os.getenv("DASHBOARD_URL", "http://localhost:8082")

    # billing
    billing_enabled: bool = _bool("BILLING_ENABLED", True)
    revenuecat_webhook_token: str = os.getenv("REVENUECAT_WEBHOOK_AUTH_TOKEN", "")
    revenuecat_api_key: str = os.getenv("REVENUECAT_SECRET_API_KEY", "")

    # posthog
    posthog_api_key: str = os.getenv("POSTHOG_API_KEY", "")
    posthog_host: str = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com")
    # Personal API key enables local evaluation of feature flags (no network
    # in the request path). Without it, flags fall back to registry defaults.
    posthog_personal_api_key: str = os.getenv("POSTHOG_PERSONAL_API_KEY", "")
    # One PostHog project is shared with the other 3m4 apps, so retro's own
    # feature switches live there under a prefixed key (``retro-signups`` ...).
    # Registry keys (packages/shared/feature_flags.json) stay unprefixed.
    posthog_flag_prefix: str = os.getenv("POSTHOG_FLAG_PREFIX", "retro-")

    # rate limiting
    rate_limit_default: str = os.getenv("RATE_LIMIT_DEFAULT", "120/minute")
    rate_limit_public_api: str = os.getenv("RATE_LIMIT_PUBLIC_API", "60/minute")
    # Ingest: per (project, ip_hash). Board: per ip_hash. Both are end-user traffic.
    rate_limit_ingest: str = os.getenv("RATE_LIMIT_INGEST", "30/minute")
    rate_limit_board: str = os.getenv("RATE_LIMIT_BOARD", "60/minute")

    # privacy: raw IPs are never stored; see dbcore/privacy.py
    ip_hash_secret: str = os.getenv("IP_HASH_SECRET", "dev-insecure-ip-salt")

    # attachments (screenshots)
    max_screenshot_bytes: int = int(os.getenv("MAX_SCREENSHOT_BYTES", str(1_500_000)))


config = Config()
