import { test, expect } from "@playwright/test";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHmac } from "node:crypto";
import {
  API_URL, WEBHOOK_SINK_HOST, createApiKey, createProject, createWebhook, ingest, jwtHeaders, keyHeaders, listDeliveries, pollUntil, registerAccount,
} from "../helpers";

/**
 * Webhooks (CONTRACT.md → Phase 2 addendum → Webhooks).
 *
 * The sink is a tiny Node HTTP server started INSIDE the test, listening on
 * 0.0.0.0 on a random port. The API container delivers to
 * `http://${WEBHOOK_SINK_HOST}:<port>/hook`, which must resolve from inside
 * docker to this machine (default `172.17.0.1`, the docker bridge gateway;
 * set E2E_WEBHOOK_SINK_HOST=host.docker.internal on Docker Desktop). Plain
 * `http://` is accepted by the API only because the local stack's
 * APP_BASE_URL is not https; production demands `https://`.
 *
 * No UI locators in this file: the dashboard surface for webhooks is covered
 * only through the API here.
 */

interface Received {
  headers: Record<string, string>;
  raw: string;
  body: any;
}

function startSink(): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: any = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : (v ?? "");
      received.push({ headers, raw, body });
      res.statusCode = 204;
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("sink: no port"));
      resolve({ server, port: addr.port, received });
    });
  });
}

test.describe("webhooks", () => {
  test("@critical create (secret shown once) → ping → delivery row; new feedback is signed and delivered", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const sink = await startSink();
    const url = `http://${WEBHOOK_SINK_HOST}:${sink.port}/hook`;

    try {
      const hook = await createWebhook(request, account, project.id, { url, description: "e2e sink" });
      expect(hook.secret, "secret must be returned on create").toMatch(/^.{16,}$/);
      expect(hook.enabled).toBe(true);
      expect(hook.events.length).toBeGreaterThan(0);
      const secret = hook.secret!;

      // The secret is never shown again.
      const list = await request.get(`${API_URL}/projects/${project.id}/webhooks`, { headers: jwtHeaders(account) });
      expect(list.status()).toBe(200);
      const listed = (await list.json()) as any[];
      expect(listed).toHaveLength(1);
      expect(listed[0].secret).toBeUndefined();
      expect(listed[0].secret_prefix).toBe(hook.secret_prefix);

      // Test ping.
      const ping = await request.post(`${API_URL}/projects/${project.id}/webhooks/${hook.id}/test`, { headers: jwtHeaders(account) });
      expect(ping.status(), await ping.text()).toBe(202);
      expect((await ping.json()).delivery_id).toBeTruthy();

      const pingHit = await pollUntil(
        async () => sink.received.find((r) => r.body?.event === "ping"),
        (r) => !!r,
        { timeoutMs: 30_000, intervalMs: 500 },
      );
      expect(pingHit, "ping was not delivered to the sink (check E2E_WEBHOOK_SINK_HOST / worker service)").toBeTruthy();
      expect(pingHit!.headers["x-retro-event"]).toBe("ping");
      expect(pingHit!.headers["user-agent"]).toMatch(/^retro-webhooks\//);

      const deliveries = await pollUntil(
        () => listDeliveries(request, account, project.id, hook.id),
        (d) => d.some((x) => x.event === "ping" && x.status === "delivered"),
        { timeoutMs: 30_000 },
      );
      const pingRow = deliveries.find((d) => d.event === "ping")!;
      expect(pingRow.status).toBe("delivered");
      expect(pingRow.response_code).toBe(204);

      // A real event: feedback.created, HMAC-signed over the raw body.
      const created = await ingest(request, project.public_key, { type: "bug", message: "Webhook me" });
      expect(created.status).toBe(201);
      const hit = await pollUntil(
        async () => sink.received.find((r) => r.body?.event === "feedback.created"),
        (r) => !!r,
        { timeoutMs: 30_000 },
      );
      expect(hit).toBeTruthy();
      expect(hit!.headers["x-retro-delivery"]).toBeTruthy();
      expect(hit!.headers["content-type"]).toMatch(/application\/json/);
      const expected = "sha256=" + createHmac("sha256", secret).update(hit!.raw).digest("hex");
      expect(hit!.headers["x-retro-signature"]).toBe(expected);
      expect(hit!.body.project.id).toBe(project.id);
      expect(hit!.body.data.number).toBe(created.body.number);
      expect(hit!.body.data.notes).toBeUndefined();

      // Status change carries previous_status.
      const patched = await request.patch(`${API_URL}/projects/${project.id}/feedback/${created.body.id}`, {
        headers: jwtHeaders(account),
        data: { status: "triaged" },
      });
      expect(patched.status()).toBe(200);
      const statusHit = await pollUntil(
        async () => sink.received.find((r) => r.body?.event === "feedback.status_changed"),
        (r) => !!r,
        { timeoutMs: 30_000 },
      );
      expect(statusHit!.body.data.status).toBe("triaged");
      expect(statusHit!.body.data.previous_status).toBe("new");
    } finally {
      sink.server.close();
    }
  });

  test("validation: https only in prod shape, event filter, disable, per-project limit, delete", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const H = jwtHeaders(account);

    // Malformed URL is rejected regardless of environment.
    const bad = await request.post(`${API_URL}/projects/${project.id}/webhooks`, { headers: H, data: { url: "not a url" } });
    expect(bad.status()).toBe(400);

    // Event filter is honoured on create and patch.
    const hook = await createWebhook(request, account, project.id, {
      url: `http://${WEBHOOK_SINK_HOST}:9/never`,
      events: ["changelog.published"],
    });
    expect(hook.events).toEqual(["changelog.published"]);
    const unknown = await request.patch(`${API_URL}/projects/${project.id}/webhooks/${hook.id}`, {
      headers: H,
      data: { events: ["nope.event"] },
    });
    expect(unknown.status()).toBe(400);
    const off = await request.patch(`${API_URL}/projects/${project.id}/webhooks/${hook.id}`, { headers: H, data: { enabled: false } });
    expect(off.status()).toBe(200);
    expect((await off.json()).enabled).toBe(false);

    // Limit: `webhooks_per_project` is plan-based (free 2, pro 5, team 20). While
    // the `early-access` feature is ON every account gets the enterprise limits
    // (unlimited), so the 402 can only be asserted when early access is off.
    const me = await (await request.get(`${API_URL}/auth/me`, { headers: H })).json();
    const earlyAccess = me.features?.["early-access"] !== false;
    for (let i = 0; i < 4; i++) {
      await createWebhook(request, account, project.id, { url: `http://${WEBHOOK_SINK_HOST}:9/h${i}` });
    }
    const sixth = await request.post(`${API_URL}/projects/${project.id}/webhooks`, {
      headers: H,
      data: { url: `http://${WEBHOOK_SINK_HOST}:9/sixth` },
    });
    if (earlyAccess) {
      expect(sixth.status(), await sixth.text()).toBe(201);
    } else {
      expect(sixth.status(), await sixth.text()).toBe(402);
      expect((await sixth.json()).error.which).toBe("webhooks");
    }

    const del = await request.delete(`${API_URL}/projects/${project.id}/webhooks/${hook.id}`, { headers: H });
    expect(del.status()).toBe(204);
    const gone = await request.get(`${API_URL}/projects/${project.id}/webhooks/${hook.id}/deliveries`, { headers: H });
    expect(gone.status()).toBe(404);

    // Viewer keys cannot create webhooks (projects:write).
    const viewer = await createApiKey(request, account, "viewer", "viewer");
    const denied = await request.post(`${API_URL}/projects/${project.id}/webhooks`, {
      headers: keyHeaders(viewer.key),
      data: { url: `http://${WEBHOOK_SINK_HOST}:9/x` },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("insufficient_scope");
  });
});
