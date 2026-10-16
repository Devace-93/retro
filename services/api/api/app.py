"""Application factory.

``create_app()`` builds and returns the Flask app. Gunicorn runs it directly::

    gunicorn -b 0.0.0.0:5000 -w 2 'api.app:create_app()'

Responsibilities here: CORS, request size cap, rate limiting, blueprint registration (billing is
conditional on ``BILLING_ENABLED``), health checks, and a small set of error
handlers that always emit the ``{"error": {...}}`` envelope.
"""
from __future__ import annotations

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException

from dbcore.config import config

from .errors import ApiError
from .extensions import limiter


def create_app() -> Flask:
    app = Flask(__name__)
    # Screenshots travel base64-encoded inside JSON; 1.5 MB of image is ~2 MB
    # of text plus the rest of the body. Anything bigger is a 413.
    app.config["MAX_CONTENT_LENGTH"] = 3 * 1024 * 1024

    # ---- CORS --------------------------------------------------------------
    # Management routes: dashboard (and apex) origins only. Ingest, board and
    # widget-config routes are called from third-party apps, so they allow any
    # origin (no credentials). flask-cors matches the FIRST resource whose
    # pattern fits, so the public ones come first.
    # flask-cors is optional at import time so `py_compile`/tests don't hard-fail
    # if it isn't installed; in the real image it always is.
    try:
        from flask_cors import CORS

        public_origins = {"origins": "*", "supports_credentials": False, "send_wildcard": True,
                          "allow_headers": ["Content-Type", "X-Project-Key", "X-Retro-Source", "Authorization"]}
        CORS(
            app,
            resources={
                r"/api/ingest/*": public_origins,
                r"/api/boards/*": public_origins,
                r"/api/features": public_origins,
                r"/api/*": {"origins": [config.dashboard_url, config.app_base_url], "supports_credentials": True},
            },
        )
    except ImportError:  # pragma: no cover
        pass

    # ---- Rate limiting (Redis-backed) --------------------------------------
    limiter.init_app(app)

    # ---- Blueprints, all mounted under /api --------------------------------
    from .blueprints.account import bp as account_bp
    from .blueprints.apikeys import bp as apikeys_bp
    from .blueprints.auth import bp as auth_bp
    from .blueprints.boards import bp as boards_bp
    from .blueprints.changelog import bp as changelog_bp
    from .blueprints.feedback import bp as feedback_bp
    from .blueprints.ingest import bp as ingest_bp
    from .blueprints.projects import bp as projects_bp
    from .blueprints.roadmap import bp as roadmap_bp
    from .blueprints.views import bp as views_bp
    from .blueprints.webhooks import bp as webhooks_bp
    from .features import bp as features_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(projects_bp, url_prefix="/api/projects")
    app.register_blueprint(feedback_bp, url_prefix="/api/projects/<project_id>/feedback")
    app.register_blueprint(roadmap_bp, url_prefix="/api/projects/<project_id>/roadmap")
    app.register_blueprint(views_bp, url_prefix="/api/projects/<project_id>/views")
    app.register_blueprint(webhooks_bp, url_prefix="/api/projects/<project_id>/webhooks")
    app.register_blueprint(changelog_bp, url_prefix="/api/projects/<project_id>/changelog")
    app.register_blueprint(ingest_bp, url_prefix="/api/ingest")
    app.register_blueprint(boards_bp, url_prefix="/api/boards")
    app.register_blueprint(account_bp, url_prefix="/api/account")
    app.register_blueprint(apikeys_bp, url_prefix="/api/apikeys")
    app.register_blueprint(features_bp, url_prefix="/api/features")

    # Billing is omitted entirely for self-host builds (BILLING_ENABLED=false).
    if config.billing_enabled:
        from .blueprints.billing import bp as billing_bp

        app.register_blueprint(billing_bp, url_prefix="/api/billing")

    # ---- Health checks ------------------------------------------------------
    # Bare /healthz for the container/load-balancer; /api/healthz behind Caddy.
    @app.get("/healthz")
    @app.get("/api/healthz")
    @limiter.exempt
    def healthz():
        return jsonify({"status": "ok"})

    _register_error_handlers(app)
    return app


def _register_error_handlers(app: Flask) -> None:
    """Every error path returns the shared ``{"error": {...}}`` JSON shape."""

    @app.errorhandler(ApiError)
    def _handle_api_error(err: ApiError):
        return jsonify(err.to_dict()), err.status

    @app.errorhandler(429)
    def _handle_rate_limit(err):
        return (
            jsonify({"error": {"code": "rate_limited", "message": "Too many requests."}}),
            429,
        )

    @app.errorhandler(HTTPException)
    def _handle_http_exception(err: HTTPException):
        # Map any other werkzeug error (404, 405, 400, ...) into our envelope.
        code = (err.name or "error").lower().replace(" ", "_")
        return (
            jsonify({"error": {"code": code, "message": err.description or err.name}}),
            err.code or 500,
        )

    @app.errorhandler(Exception)
    def _handle_unexpected(err: Exception):  # pragma: no cover
        app.logger.exception("Unhandled exception")
        return (
            jsonify({"error": {"code": "internal_error", "message": "An unexpected error occurred."}}),
            500,
        )
