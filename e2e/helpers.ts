import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { BASE_URL } from "./playwright.config";

export const API_URL = `${BASE_URL}/api`;
export const MCP_URL = `${BASE_URL}/mcp`;
export const WIDGET_URL = `${BASE_URL}/widget.js`;

/**
 * Identity lives at accounts.3m4.net. Locally that is the accounts stack on
 * :8085 (Mailpit on :8025 for the verification mail); the `3m4_session`
 * cookie it sets for `localhost` is sent to this app on :8082 as well.
 */
export const ACCOUNTS_URL = (process.env.E2E_ACCOUNTS_URL || "http://localhost:8085").replace(/\/$/, "");
export const MAILPIT_URL = (process.env.E2E_MAILPIT_URL || "http://localhost:8025").replace(/\/$/, "");
export const SESSION_COOKIE = "3m4_session";

export const PASSWORD = "E2e-Passw0rd!";

export type Role = "viewer" | "editor" | "admin";

export interface Account {
  email: string;
  password: string;
  /** Accounts identity id (`sub`). */
  identityId: string;
  handle: string;
  /** The app's local user / account ids, from /auth/me. */
  userId: string;
  accountId: string;
  /** The current `3m4_session` JWT (also accepted as a bearer by the API). */
  sessionToken: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  public_key: string;
  public_key_prefix: string;
  board_slug: string;
  board_enabled: boolean;
  board_url: string | null;
  types_enabled: string[];
}

export interface FeedbackItem {
  id: string;
  number: number;
  type: string;
  status: string;
  title: string;
  message: string;
  source: string;
  has_screenshot: boolean;
}

export function uniqueEmail(tag = "e2e"): string {
  return `${tag}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export function uniqueName(prefix = "E2E app"): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ─── Mailpit (local accounts stack) ──────────────────────────────────────── */

interface MailpitSummary {
  ID: string;
  Created: string;
}

async function mailpitJson<T>(path: string): Promise<T> {
  const res = await fetch(`${MAILPIT_URL}/api/v1${path}`);
  if (!res.ok) throw new Error(`mailpit ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** The accounts e-mail verification token sent to `email` (polls Mailpit). */
export async function waitForVerifyToken(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mailpitJson<{ messages: MailpitSummary[] }>(
      `/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    for (const m of found.messages ?? []) {
      const msg = await mailpitJson<{ Text?: string; HTML?: string }>(`/message/${m.ID}`);
      const match = `${msg.Text ?? ""}\n${msg.HTML ?? ""}`.match(/verify\?token=([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no verification mail for ${email} at ${MAILPIT_URL}`);
}

async function sessionCookie(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  const cookie = state.cookies.find((c) => c.name === SESSION_COOKIE);
  expect(cookie, "3m4_session cookie after accounts login").toBeTruthy();
  return cookie!.value;
}

/**
 * Create a fresh, verified identity at accounts and let this app provision
 * its tenant. The cookies stay in `request`'s jar, so later calls to the app
 * API from the same context are authenticated. Never reuses existing data.
 */
export async function registerAccount(
  request: APIRequestContext,
  opts: { email?: string } = {},
): Promise<Account> {
  const email = opts.email ?? uniqueEmail();
  const signup = await request.post(`${ACCOUNTS_URL}/api/auth/signup`, {
    data: { email, password: PASSWORD },
  });
  expect(signup.status(), `accounts signup ${email}: ${await signup.text()}`).toBe(201);
  const identity = (await signup.json()).user as { id: string; handle: string };

  // Verify the e-mail (the app refuses writes until then) and refresh so the
  // access cookie carries email_verified=true.
  const token = await waitForVerifyToken(email);
  const verify = await request.post(`${ACCOUNTS_URL}/api/auth/verify/consume`, { data: { token } });
  expect(verify.status(), `verify consume: ${await verify.text()}`).toBe(200);
  const refresh = await request.post(`${ACCOUNTS_URL}/api/session/refresh`, { data: {} });
  expect(refresh.status(), `session refresh: ${await refresh.text()}`).toBe(200);

  // First call provisions the local user + workspace.
  const me = await request.get(`${API_URL}/auth/me`);
  expect(me.status(), `auth/me: ${await me.text()}`).toBe(200);
  const body = await me.json();
  return {
    email,
    password: PASSWORD,
    identityId: identity.id,
    handle: identity.handle,
    userId: body.user.id,
    accountId: body.account.id,
    sessionToken: await sessionCookie(request),
  };
}

/** Bearer form of the session (for request contexts without the cookie jar). */
export function jwtHeaders(account: Pick<Account, "sessionToken">) {
  return { Authorization: `Bearer ${account.sessionToken}` };
}

export function keyHeaders(key: string) {
  return { "X-API-Key": key };
}

export function projectKeyHeaders(publicKey: string) {
  return { "X-Project-Key": publicKey };
}

/** POST /api/projects with a JWT. Returns the project including its public key. */
export async function createProject(
  request: APIRequestContext,
  account: Account,
  opts: { name?: string; url?: string } = {},
): Promise<Project> {
  const res = await request.post(`${API_URL}/projects`, {
    headers: jwtHeaders(account),
    data: { name: opts.name ?? uniqueName(), url: opts.url },
  });
  expect(res.status(), `create project: ${await res.text()}`).toBe(201);
  return res.json();
}

/** PATCH /api/projects/:id. */
export async function patchProject(
  request: APIRequestContext,
  account: Account,
  projectId: string,
  patch: Record<string, unknown>,
): Promise<Project> {
  const res = await request.patch(`${API_URL}/projects/${projectId}`, {
    headers: jwtHeaders(account),
    data: patch,
  });
  expect(res.status(), `patch project: ${await res.text()}`).toBe(200);
  return res.json();
}

/** POST /api/apikeys with a JWT. Returns the one-time secret plus metadata. */
export async function createApiKey(
  request: APIRequestContext,
  account: Account,
  name: string,
  role: Role,
): Promise<{ id: string; key: string; prefix: string; role: Role }> {
  const res = await request.post(`${API_URL}/apikeys`, {
    headers: jwtHeaders(account),
    data: { name, role },
  });
  expect(res.status(), `create api key: ${await res.text()}`).toBe(201);
  return res.json();
}

/** Send one feedback item through the public ingest API. */
export async function ingest(
  request: APIRequestContext,
  publicKey: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await request.post(`${API_URL}/ingest/feedback`, {
    headers: { ...projectKeyHeaders(publicKey), ...headers },
    data: body,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status(), body: parsed };
}

/** GET /api/projects/:id/feedback as the owner. */
export async function listFeedback(
  request: APIRequestContext,
  account: Account,
  projectId: string,
  query: Record<string, string> = {},
): Promise<{ items: FeedbackItem[]; total: number }> {
  const qs = new URLSearchParams(query).toString();
  const res = await request.get(`${API_URL}/projects/${projectId}/feedback${qs ? `?${qs}` : ""}`, {
    headers: jwtHeaders(account),
  });
  expect(res.status(), `list feedback: ${await res.text()}`).toBe(200);
  return res.json();
}

/**
 * Give the browser the accounts session of `account` (fast path for dashboard
 * tests): sets the `3m4_session` cookie for the app's host exactly as accounts
 * would (host-only on localhost). The token is good for 15 minutes, plenty for
 * a spec; no refresh cookie is seeded. No navigation needed.
 */
export async function seedSession(page: Page, account: Pick<Account, "sessionToken">): Promise<void> {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: account.sessionToken,
      domain: new URL(BASE_URL).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** Poll an async condition until it holds. */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  { timeoutMs = 15_000, intervalMs = 500 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

/** A 1×1 PNG as a data URL, for screenshot upload tests. */
export const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// --------------------------------------------------------------------------- //
// Phase 2 helpers (CONTRACT.md → "Phase 2 addendum")
// --------------------------------------------------------------------------- //

export interface FeedbackDetail extends FeedbackItem {
  similar?: { id: string; number: number; title: string; status: string; similarity: number }[];
  duplicate_of?: string | null;
  tags?: string[];
  notes?: { id: string; body: string; kind?: string; delivery?: string; created_at: string }[];
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  description?: string | null;
  enabled: boolean;
  secret_prefix: string;
  /** Full secret; present ONLY on create. */
  secret?: string;
  last_delivery_at?: string | null;
  last_status?: string | null;
  created_at: string;
}

export interface Delivery {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  response_code?: number | null;
  last_error?: string | null;
  created_at: string;
  delivered_at?: string | null;
}

export interface SavedView {
  id: string;
  name: string;
  filters: Record<string, string>;
  position: number;
  created_at: string;
}

/** GET /api/projects/:id/feedback/:item (detail, with notes / similar / duplicate_of). */
export async function getFeedback(
  request: APIRequestContext,
  account: Account,
  projectId: string,
  item: string | number,
): Promise<FeedbackDetail> {
  const res = await request.get(`${API_URL}/projects/${projectId}/feedback/${item}`, {
    headers: jwtHeaders(account),
  });
  expect(res.status(), `get feedback ${item}: ${await res.text()}`).toBe(200);
  return res.json();
}

/** POST /api/projects/:id/webhooks → Webhook with its one-time secret. */
export async function createWebhook(
  request: APIRequestContext,
  account: Account,
  projectId: string,
  body: { url: string; events?: string[]; description?: string },
): Promise<Webhook> {
  const res = await request.post(`${API_URL}/projects/${projectId}/webhooks`, {
    headers: jwtHeaders(account),
    data: body,
  });
  expect(res.status(), `create webhook: ${await res.text()}`).toBe(201);
  return res.json();
}

/** GET /api/projects/:id/webhooks/:wid/deliveries. */
export async function listDeliveries(
  request: APIRequestContext,
  account: Account,
  projectId: string,
  webhookId: string,
  limit = 20,
): Promise<Delivery[]> {
  const res = await request.get(`${API_URL}/projects/${projectId}/webhooks/${webhookId}/deliveries?limit=${limit}`, {
    headers: jwtHeaders(account),
  });
  expect(res.status(), `list deliveries: ${await res.text()}`).toBe(200);
  return res.json();
}

/**
 * Host reachable FROM the api container. The webhook sink runs on the host
 * machine, so the API (inside docker) must dial out to the docker bridge
 * gateway (`172.17.0.1` on a default Linux install) or `host.docker.internal`
 * (Docker Desktop / compose with `extra_hosts`). Override with
 * E2E_WEBHOOK_SINK_HOST.
 */
export const WEBHOOK_SINK_HOST = process.env.E2E_WEBHOOK_SINK_HOST || "172.17.0.1";

/** Parse a `text/csv` body into rows (good enough for our own export; no quoted newlines). */
export function parseCsvHeader(csv: string): string[] {
  const first = csv.split(/\r?\n/)[0] ?? "";
  return first.split(",").map((c) => c.replace(/^"|"$/g, ""));
}
