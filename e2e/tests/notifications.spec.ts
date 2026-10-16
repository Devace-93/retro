import { test, expect } from "@playwright/test";
import { API_URL, createProject, getFeedback, ingest, jwtHeaders, registerAccount } from "../helpers";

/**
 * Notification settings + reply to reporter (CONTRACT.md → Phase 2 addendum →
 * Notifications / Reply to the reporter).
 *
 * The local stack runs with MAIL_ENABLED=false, so replies answer 503
 * mail_disabled; set E2E_MAIL_ENABLED=true to assert the queued path instead.
 * No UI locators in this file.
 */
const MAIL = process.env.E2E_MAIL_ENABLED === "true";

test.describe("notifications", () => {
  test("@critical settings default to ON / 60 min and round-trip", async ({ request }) => {
    const account = await registerAccount(request);
    const H = jwtHeaders(account);

    const initial = await request.get(`${API_URL}/account/notifications`, { headers: H });
    expect(initial.status(), await initial.text()).toBe(200);
    const s0 = await initial.json();
    expect(s0.email_new_feedback).toBe(true);
    expect(s0.email_digest_minutes).toBe(60);
    expect(s0.email).toBe(account.email);

    const set = await request.patch(`${API_URL}/account/notifications`, { headers: H, data: { email_new_feedback: false, email_digest_minutes: 1440 } });
    expect(set.status(), await set.text()).toBe(200);
    const s1 = await set.json();
    expect(s1.email_new_feedback).toBe(false);
    expect(s1.email_digest_minutes).toBe(1440);

    const again = await (await request.get(`${API_URL}/account/notifications`, { headers: H })).json();
    expect(again).toMatchObject({ email_new_feedback: false, email_digest_minutes: 1440 });

    for (const bad of [7, -1, "soon"]) {
      const r = await request.patch(`${API_URL}/account/notifications`, { headers: H, data: { email_digest_minutes: bad } });
      expect(r.status(), `digest ${bad}`).toBe(400);
    }
    const instant = await request.patch(`${API_URL}/account/notifications`, { headers: H, data: { email_digest_minutes: 0 } });
    expect(instant.status()).toBe(200);
  });

  test("reply: needs a reporter email; disabled mail answers 503 mail_disabled", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const H = jwtHeaders(account);

    const anon = await ingest(request, project.public_key, { type: "bug", message: "no email here" });
    const withEmail = await ingest(request, project.public_key, { type: "bug", message: "please reply", email: "reporter@example.com" });
    expect(anon.status).toBe(201);
    expect(withEmail.status).toBe(201);

    const noAddr = await request.post(`${API_URL}/projects/${project.id}/feedback/${anon.body.id}/reply`, { headers: H, data: { body: "Hi" } });
    if (MAIL) {
      expect(noAddr.status(), await noAddr.text()).toBe(400);
      expect((await noAddr.json()).error.code).toBe("no_reporter_email");
    } else {
      // Either precondition may be checked first; both are contract errors.
      expect([400, 503]).toContain(noAddr.status());
    }

    const reply = await request.post(`${API_URL}/projects/${project.id}/feedback/${withEmail.body.id}/reply`, { headers: H, data: { body: "Thanks, fixed in 1.4.1" } });
    if (!MAIL) {
      expect(reply.status(), await reply.text()).toBe(503);
      expect((await reply.json()).error.code).toBe("mail_disabled");
      return;
    }
    expect(reply.status(), await reply.text()).toBe(201);
    const note = await reply.json();
    expect(note.kind).toBe("reply");
    expect(["pending", "sent", "failed"]).toContain(note.delivery);
    const detail = await getFeedback(request, account, project.id, withEmail.body.id);
    expect((detail.notes ?? []).some((n) => n.kind === "reply" && n.body.includes("1.4.1"))).toBe(true);

    const empty = await request.post(`${API_URL}/projects/${project.id}/feedback/${withEmail.body.id}/reply`, { headers: H, data: { body: "   " } });
    expect(empty.status()).toBe(400);
  });
});
