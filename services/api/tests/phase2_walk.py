"""Phase 2 contract walk (Flask test client + the outbox worker, in-process).

Run against a throwaway Postgres, e.g. from the API image:

    docker run --rm --network host -v "$PWD:/app" \
      -e DATABASE_URL=postgresql+psycopg://retro:x@localhost:55432/retro \
      -e REDIS_URL=memory:// -e FEATURE_FLAG_OVERRIDES=early-access=off \
      retro-api python /app/services/api/tests/phase2_walk.py

It migrates the database first (``dbcore.cli upgrade``), then exercises
notifications, digests, replies, webhooks (with a local HTTP sink to verify
the HMAC signature), export, saved views, duplicates + merge and Turnstile.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.setdefault("REDIS_URL", "memory://")
os.environ.setdefault("APP_BASE_URL", "http://localhost:8082")
os.environ.setdefault("DASHBOARD_URL", "http://localhost:8082")
os.environ.setdefault("BILLING_ENABLED", "false")
os.environ.setdefault("FEATURE_FLAG_OVERRIDES", "early-access=off")

sys.path.insert(0, "/app")
sys.path.insert(0, "/app/services/api")  # the image copies this to /app/api; mounted repos need the hint

from dbcore import cli as dbcli  # noqa: E402
from dbcore import worker  # noqa: E402
from dbcore.config import config  # noqa: E402
from dbcore.db import session_scope  # noqa: E402
from dbcore.models import FeedbackItem, FeedbackNote, Outbox, Webhook, WebhookDelivery  # noqa: E402
from sqlalchemy import select  # noqa: E402

CHECKS = 0


def check(cond, label):
    global CHECKS
    CHECKS += 1
    if not cond:
        print(f"✗ {label}")
        sys.exit(1)
    print(f"✓ {label}")


def set_config(**values):
    for k, v in values.items():
        object.__setattr__(config, k, v)


# --------------------------------------------------------------------------- #
# Webhook sink
# --------------------------------------------------------------------------- #
RECEIVED: list[dict] = []
SINK_PORT = 18089


class Sink(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        RECEIVED.append({"path": self.path, "headers": dict(self.headers), "body": body})
        status = 500 if self.path.startswith("/fail") else 200
        self.send_response(status)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):  # quiet
        pass


def start_sink():
    server = HTTPServer(("127.0.0.1", SINK_PORT), Sink)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# --------------------------------------------------------------------------- #
def main():
    dbcli.create_all()
    dbcli.migrate()

    from api.app import create_app

    app = create_app()
    client = app.test_client()
    start_sink()

    def j(resp):
        return resp.get_json()

    # --- account -----------------------------------------------------------
    email = f"walk+{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/auth/register", json={"email": email, "password": "Walk-Passw0rd!", "account_name": "Walk"})
    check(r.status_code == 201, "register")
    token = j(r)["access_token"]
    H = {"Authorization": f"Bearer {token}"}

    r = client.get("/api/account/notifications", headers=H)
    check(r.status_code == 200 and j(r) == {"email_new_feedback": True, "email_digest_minutes": 60, "email": email}, "notification defaults")
    r = client.patch("/api/account/notifications", headers=H, json={"email_digest_minutes": 15})
    check(r.status_code == 200 and j(r)["email_digest_minutes"] == 15, "notification patch")
    r = client.patch("/api/account/notifications", headers=H, json={"email_digest_minutes": 7})
    check(r.status_code == 400 and j(r)["error"]["code"] == "invalid_digest", "notification invalid cadence")

    # --- project -----------------------------------------------------------
    r = client.post("/api/projects", headers=H, json={"name": "Walk app"})
    check(r.status_code == 201, "create project")
    project = j(r)
    pid, pub = project["id"], project["public_key"]
    check(project["turnstile_enabled"] is False and project["turnstile_site_key"] is None, "project turnstile fields")
    PK = {"X-Project-Key": pub}

    def ingest(message, **extra):
        body = {"type": "bug", "message": message, **extra}
        return client.post("/api/ingest/feedback", headers=PK, json=body)

    # --- digest: mail disabled → no job -------------------------------------
    r = ingest("Mail is off for this one")
    check(r.status_code == 201, "ingest with mail disabled")
    with session_scope() as s:
        n = s.scalar(select(Outbox.id).where(Outbox.kind == "email"))
    check(n is None, "no digest queued while mail is disabled")

    # --- enable mail (unreachable SMTP) → digest queued ---------------------
    set_config(mail_enabled=True, smtp_url="smtp://127.0.0.1:1")
    r1 = ingest("The export button does nothing on Firefox 131, it just spins.", email="reporter@example.com")
    r2 = ingest("Export button does nothing on Firefox 131 - spinner forever then nothing")
    check(r1.status_code == 201 and r2.status_code == 201, "ingest two similar bugs")
    n1, n2 = j(r1)["number"], j(r2)["number"]
    with session_scope() as s:
        jobs = s.scalars(select(Outbox).where(Outbox.kind == "email", Outbox.status == "pending")).all()
        check(len(jobs) == 1 and jobs[0].payload["template"] == "digest", "one pending digest job")
        check(len(jobs[0].payload["item_ids"]) == 2, "second item joined the pending digest")
        due = jobs[0].next_attempt_at - datetime.now(timezone.utc)
        check(timedelta(minutes=13) < due < timedelta(minutes=16), "digest due in ~15 minutes")

    # --- duplicates --------------------------------------------------------
    r = client.get(f"/api/projects/{pid}/feedback/{n2}", headers=H)
    d = j(r)
    check(r.status_code == 200 and d["similar"] and d["similar"][0]["number"] == n1, f"similar detected ({d['similar'][0]['similarity'] if d['similar'] else '-'})")
    check(d["duplicate_of"] is None, "duplicate_of null before merge")
    r = client.patch(f"/api/projects/{pid}/feedback/{n2}", headers=H, json={"tags": ["firefox"]})
    check(r.status_code == 200, "tag the duplicate")
    r = client.post(f"/api/projects/{pid}/feedback/{n2}/merge", headers=H, json={"into": n2})
    check(r.status_code == 400 and j(r)["error"]["code"] == "invalid_merge", "merge into itself rejected")
    r = client.post(f"/api/projects/{pid}/feedback/{n2}/merge", headers=H, json={"into": n1})
    m = j(r)
    check(r.status_code == 200 and m["status"] == "declined" and m["duplicate_of"], "merge marks duplicate declined + linked")
    r = client.get(f"/api/projects/{pid}/feedback/{n1}", headers=H)
    t = j(r)
    check("firefox" in t["tags"], "tags carried onto the target")
    check(any(n["author"] and n["author"].get("label") == "system" and "Merged" in n["body"] for n in t["notes"]), "system note on target")
    r = client.get(f"/api/projects/{pid}/feedback?duplicates=hide", headers=H)
    check(all(i["number"] != n2 for i in j(r)["items"]), "duplicates=hide hides merged item")
    r = client.get(f"/api/projects/{pid}/feedback", headers=H)
    check(any(i["number"] == n2 for i in j(r)["items"]), "duplicates=show keeps it")

    # --- reply -------------------------------------------------------------
    r = client.post(f"/api/projects/{pid}/feedback/{n2}/reply", headers=H, json={"body": "Thanks!"})
    check(r.status_code == 400 and j(r)["error"]["code"] == "no_reporter_email", "reply without reporter email")
    set_config(mail_enabled=False)
    r = client.post(f"/api/projects/{pid}/feedback/{n1}/reply", headers=H, json={"body": "Thanks!"})
    check(r.status_code == 503 and j(r)["error"]["code"] == "mail_disabled", "reply with mail disabled")
    set_config(mail_enabled=True)
    r = client.post(f"/api/projects/{pid}/feedback/{n1}/reply", headers=H, json={"body": "Thanks, fixed in 1.4.1!"})
    note = j(r)
    check(r.status_code == 201 and note["kind"] == "reply" and note["delivery"] == "pending", "reply queued")
    reply_note_id = note["id"]

    # --- webhooks ----------------------------------------------------------
    sink_ok = f"http://127.0.0.1:{SINK_PORT}/ok"
    sink_fail = f"http://127.0.0.1:{SINK_PORT}/fail"
    r = client.post(f"/api/projects/{pid}/webhooks", headers=H, json={"url": sink_ok, "description": "sink"})
    hook = j(r)
    check(r.status_code == 201 and hook["secret"].startswith("whsec_") and hook["secret_prefix"] == hook["secret"][:12], "create webhook returns secret once")
    secret, wid = hook["secret"], hook["id"]
    check(hook["events"] == ["feedback.created", "feedback.status_changed", "roadmap.status_changed", "changelog.published", "ping"], "default events = all")
    r = client.get(f"/api/projects/{pid}/webhooks", headers=H)
    check(r.status_code == 200 and "secret" not in j(r)[0], "list hides the secret")
    r = client.post(f"/api/projects/{pid}/webhooks", headers=H, json={"url": "ftp://nope"})
    check(r.status_code == 400 and j(r)["error"]["code"] == "invalid_url", "invalid url rejected")
    r = client.post(f"/api/projects/{pid}/webhooks", headers=H, json={"url": sink_fail, "events": ["ping"]})
    check(r.status_code == 201, "second webhook (ping only, failing sink)")
    wid_fail = j(r)["id"]
    r = client.post(f"/api/projects/{pid}/webhooks", headers=H, json={"url": sink_ok})
    check(r.status_code == 402 and j(r)["error"]["which"] == "webhooks", "free plan: third webhook is 402")
    r = client.patch(f"/api/projects/{pid}/webhooks/{wid}", headers=H, json={"description": "renamed"})
    check(r.status_code == 200 and j(r)["description"] == "renamed", "patch webhook")
    r = client.post(f"/api/projects/{pid}/webhooks/{wid}/test", headers=H)
    check(r.status_code == 202 and j(r)["delivery_id"], "test ping queued")
    r = client.post(f"/api/projects/{pid}/webhooks/{wid_fail}/test", headers=H)
    check(r.status_code == 202, "test ping queued (failing sink)")

    # events: created, status change, roadmap, changelog
    r = ingest("A new bug after the webhook exists")
    n3 = j(r)["number"]
    r = client.patch(f"/api/projects/{pid}/feedback/{n3}", headers=H, json={"status": "triaged"})
    check(r.status_code == 200, "status change")
    r = client.post(f"/api/projects/{pid}/feedback/{n3}/promote", headers=H, json={})
    check(r.status_code == 201, "promote")
    rid = j(r)["roadmap_item"]["id"]
    r = client.patch(f"/api/projects/{pid}/roadmap/{rid}", headers=H, json={"status": "in_progress"})
    check(r.status_code == 200, "roadmap status change")
    r = client.post(f"/api/projects/{pid}/changelog", headers=H, json={"title": "Fixed export", "body": "done", "publish": True})
    check(r.status_code == 201, "changelog publish")
    r = client.get(f"/api/projects/{pid}/webhooks/{wid}/deliveries", headers=H)
    events = sorted(d["event"] for d in j(r))
    check(events == sorted(["ping", "feedback.created", "feedback.status_changed", "feedback.status_changed", "feedback.status_changed", "roadmap.status_changed", "changelog.published"]), f"deliveries queued: {events}")
    check(all(d["status"] == "pending" for d in j(r)), "deliveries pending before the worker runs")

    # --- saved views -------------------------------------------------------
    r = client.post(f"/api/projects/{pid}/views", headers=H, json={"name": "Open bugs", "filters": {"type": ["bug"], "status": "new,triaged", "sort": "newest"}})
    check(r.status_code == 201 and j(r)["filters"] == {"type": "bug", "status": "new,triaged", "sort": "newest"}, "create saved view")
    vid = j(r)["id"]
    r = client.post(f"/api/projects/{pid}/views", headers=H, json={"name": "Bad", "filters": {"status": "nope"}})
    check(r.status_code == 400 and j(r)["error"]["code"] == "invalid_filters", "invalid view filters")
    r = client.patch(f"/api/projects/{pid}/views/{vid}", headers=H, json={"name": "Bugs to look at"})
    check(r.status_code == 200 and j(r)["name"] == "Bugs to look at", "rename view")
    r = client.get(f"/api/projects/{pid}/views", headers=H)
    check(r.status_code == 200 and len(j(r)) == 1, "list views")
    r = client.delete(f"/api/projects/{pid}/views/{vid}", headers=H)
    check(r.status_code == 204, "delete view")

    # --- export ------------------------------------------------------------
    r = client.get(f"/api/projects/{pid}/export", headers=H)
    ex = j(r)
    check(r.status_code == 200 and ex["format"] == "retro.project.v1" and len(ex["feedback"]) == 4 and len(ex["roadmap"]) == 1 and len(ex["changelog"]) == 1, "export json")
    check("similar" not in ex["feedback"][0] and "notes" in ex["feedback"][0], "export feedback carries notes, not similar")
    r = client.get(f"/api/projects/{pid}/export?format=csv", headers=H)
    first = r.get_data(as_text=True).splitlines()[0]
    check(r.status_code == 200 and r.mimetype == "text/csv" and first.startswith("number,type,sentiment,status"), "export csv")
    check("attachment; filename=" in r.headers.get("Content-Disposition", ""), "csv content-disposition")

    # --- turnstile ---------------------------------------------------------
    r = client.patch(f"/api/projects/{pid}", headers=H, json={"turnstile_site_key": "1x000", "turnstile_secret": "2x000"})
    p = j(r)
    check(r.status_code == 200 and p["turnstile_enabled"] is True and p["turnstile_site_key"] == "1x000" and "turnstile_secret" not in p, "turnstile configured, secret write-only")
    r = client.get("/api/ingest/config", headers=PK)
    check(j(r)["turnstile_site_key"] == "1x000", "widget config carries the site key")
    r = ingest("No token here")
    check(r.status_code == 400 and j(r)["error"]["code"] == "captcha_failed", "ingest without token → captcha_failed")

    import api.blueprints.ingest as ingest_mod
    ingest_mod.verify_turnstile = lambda secret, token, ip=None: None  # Cloudflare outage
    r = ingest("Outage case", turnstile_token="x")
    check(r.status_code == 201, "verification outage accepts the item")
    r = client.get(f"/api/projects/{pid}/feedback/{j(r)['number']}", headers=H)
    check("unverified" in j(r)["tags"], "…tagged unverified")
    ingest_mod.verify_turnstile = lambda secret, token, ip=None: bool(token == "good")
    r = ingest("Valid token", turnstile_token="good")
    check(r.status_code == 201, "valid token accepted")
    r = ingest("Bad token", turnstile_token="bad")
    check(r.status_code == 400, "invalid token rejected")
    client.patch(f"/api/projects/{pid}", headers=H, json={"board_enabled": True})
    r = client.get(f"/api/boards/{p['board_slug']}")
    check(r.status_code == 200 and j(r)["turnstile_site_key"] == "1x000", "board carries the site key")
    r = client.post(f"/api/boards/{p['board_slug']}/feedback", json={"message": "board idea, no token"})
    check(r.status_code == 400 and j(r)["error"]["code"] == "captcha_failed", "board submission needs the token too")
    client.patch(f"/api/projects/{pid}", headers=H, json={"turnstile_site_key": None, "turnstile_secret": None})

    # --- worker ------------------------------------------------------------
    with session_scope() as s:
        # make the digest due now so the drain picks it up
        for job in s.scalars(select(Outbox).where(Outbox.status == "pending")):
            job.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    counts = worker.drain()
    print("   drain:", counts)
    check(counts.get("sent", 0) >= 7, "webhook deliveries sent")
    check(counts.get("retry", 0) >= 3, "unreachable SMTP (2 mails) + failing sink retried")

    with session_scope() as s:
        hook_row = s.get(Webhook, uuid.UUID(wid))
        check(hook_row.last_status == "delivered" and hook_row.last_delivery_at is not None, "webhook last_status delivered")
        delivered = s.scalars(select(WebhookDelivery).where(WebhookDelivery.webhook_id == hook_row.id)).all()
        check(all(d.status == "delivered" and d.response_code == 200 for d in delivered), "every delivery row delivered/200")
        failing = s.scalars(select(WebhookDelivery).where(WebhookDelivery.webhook_id == uuid.UUID(wid_fail))).all()
        check(len(failing) == 1 and failing[0].status == "pending" and failing[0].response_code == 500 and failing[0].attempts == 1, "failing sink delivery pending retry with 500")
        retry_job = s.scalar(select(Outbox).where(Outbox.kind == "webhook", Outbox.status == "pending"))
        wait = retry_job.next_attempt_at - datetime.now(timezone.utc)
        check(timedelta(seconds=50) < wait < timedelta(seconds=70), "retry backoff ~1 min after attempt 1")
        note_row = s.get(FeedbackNote, uuid.UUID(reply_note_id))
        check(note_row.delivery == "pending", "reply note delivery still pending after SMTP failure")
        mail_jobs = s.scalars(select(Outbox).where(Outbox.kind == "email")).all()
        check(all(m.status == "pending" and m.attempts == 1 and "refused" in (m.last_error or "").lower() or "connect" in (m.last_error or "").lower() for m in mail_jobs), f"mail jobs retried with the SMTP error: {[m.last_error for m in mail_jobs]}")

    # signature + headers on the sink
    ok_hits = [h for h in RECEIVED if h["path"] == "/ok"]
    # 7 queued at the deliveries check + feedback.created for the two Turnstile-era items
    check(len(ok_hits) == 9, f"sink received 9 signed posts ({len(ok_hits)})")
    for hit in ok_hits:
        expected = "sha256=" + hmac.new(secret.encode(), hit["body"], hashlib.sha256).hexdigest()
        if hit["headers"].get("X-Retro-Signature") != expected:
            check(False, "signature mismatch")
    check(True, "HMAC signatures verify with the secret")
    sample = json.loads(ok_hits[0]["body"])
    check(set(sample) == {"id", "event", "created_at", "project", "data"} and sample["project"]["id"] == pid, "payload shape")
    check(ok_hits[0]["headers"].get("User-Agent") == "retro-webhooks/1" and ok_hits[0]["headers"].get("X-Retro-Event") == sample["event"] and ok_hits[0]["headers"].get("X-Retro-Delivery") == sample["id"], "delivery headers")
    created = [json.loads(h["body"]) for h in ok_hits if json.loads(h["body"])["event"] == "feedback.status_changed"]
    check(all("previous_status" in c["data"] for c in created), "status_changed payloads carry previous_status")

    # mail "sent" path with a fake SMTP: monkeypatch send to prove the digest content assembles
    sent_mails = []
    worker.send_mail = lambda **kw: (sent_mails.append(kw), "sent")[1]
    with session_scope() as s:
        for job in s.scalars(select(Outbox).where(Outbox.kind == "email")):
            job.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    counts = worker.drain()
    check(counts.get("sent", 0) == 2, "digest + reply sent through the mail transport")
    digest = next(m for m in sent_mails if "new feedback item" in m["subject"])
    check(digest["to"] == [email] and f"#{n1}" in digest["text"] and f"#{n2}" in digest["text"], "digest goes to the owner and lists both items")
    rep = next(m for m in sent_mails if m["subject"].startswith("Re: #"))
    check(rep["to"] == ["reporter@example.com"] and rep["reply_to"] == email and "Thanks, fixed" in rep["text"] and "> " in rep["text"], "reply mail: reporter, Reply-To owner, quoted original")
    with session_scope() as s:
        note_row = s.get(FeedbackNote, uuid.UUID(reply_note_id))
        check(note_row.delivery == "sent", "reply note delivery mirrored as sent")
    r = client.get(f"/api/projects/{pid}/feedback/{n1}", headers=H)
    check(any(n["kind"] == "reply" and n["delivery"] == "sent" for n in j(r)["notes"]), "detail shows the reply with delivery=sent")

    # audit actions present
    r = client.get("/api/account/audit?limit=200", headers=H)
    actions = {a["action"] for a in j(r)["items"]}
    for a in ("webhook.create", "webhook.update", "feedback.reply", "feedback.merge", "account.notifications"):
        check(a in actions, f"audit {a}")

    print(f"\n✓ phase 2 walk complete: {CHECKS} checks")


if __name__ == "__main__":
    main()
