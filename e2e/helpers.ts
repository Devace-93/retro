import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { BASE_URL } from "./playwright.config";

export const API_URL = `${BASE_URL}/api`;
export const MCP_URL = `${BASE_URL}/mcp`;
export const WIDGET_URL = `${BASE_URL}/widget.js`;

/** localStorage keys used by apps/web/src/lib/auth.ts (see CONTRACT.md). */
export const ACCESS_KEY = "retro_access_token";
export const REFRESH_KEY = "retro_refresh_token";

export const PASSWORD = "E2e-Passw0rd!";

export type Role = "viewer" | "editor" | "admin";

export interface Account {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  accountId: string;
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

/** Create a fresh account through the API. Never reuses existing data. */
export async function registerAccount(
  request: APIRequestContext,
  opts: { email?: string; accountName?: string } = {},
): Promise<Account> {
  const email = opts.email ?? uniqueEmail();
  const res = await request.post(`${API_URL}/auth/register`, {
    data: { email, password: PASSWORD, account_name: opts.accountName },
  });
  expect(res.status(), `register ${email}: ${await res.text()}`).toBe(201);
  const body = await res.json();
  return {
    email,
    password: PASSWORD,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    userId: body.user.id,
    accountId: body.account.id,
  };
}

export function jwtHeaders(account: Pick<Account, "accessToken">) {
  return { Authorization: `Bearer ${account.accessToken}` };
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
 * Seed the browser session with API-issued tokens (fast path for dashboard
 * tests). The app reads them from localStorage on hydration. Must be called
 * after the page is on the app origin (localStorage is origin-scoped).
 */
export async function seedSession(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await page.evaluate(
    ([ak, rk, at, rt]) => {
      localStorage.setItem(ak, at);
      localStorage.setItem(rk, rt);
    },
    [ACCESS_KEY, REFRESH_KEY, account.accessToken, account.refreshToken] as const,
  );
}

/** Log in through the real /login form. */
export async function loginViaUi(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
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
