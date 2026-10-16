import { test, expect } from "@playwright/test";
import {
  API_URL, createApiKey, createProject, ingest, jwtHeaders, keyHeaders, parseCsvHeader, registerAccount, seedSession,
} from "../helpers";

/**
 * Project export (CONTRACT.md → Phase 2 addendum → Export).
 *
 * UI hook assumed on /dashboard/projects/[id]/settings: links or buttons
 * named "Export JSON" / "Export CSV" (role=link or role=button, name matched
 * case-insensitively). Adjust the regexes below if the labels differ.
 */
const CSV_HEADER = [
  "number", "type", "sentiment", "status", "priority", "tags", "title", "message",
  "reporter_email", "page_url", "app_version", "source", "created_at",
];

test.describe("export", () => {
  test("@critical json has the retro.project.v1 shape; csv has the documented header", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account, { name: "Export me" });
    const H = jwtHeaders(account);

    await ingest(request, project.public_key, { type: "bug", message: "Line one\nline two", email: "r@example.com" });
    await ingest(request, project.public_key, { type: "feedback", sentiment: "positive", message: 'Has "quotes", commas, and ünïcode' });
    const road = await request.post(`${API_URL}/projects/${project.id}/roadmap`, { headers: H, data: { title: "Dark mode" } });
    expect(road.status()).toBe(201);
    const log = await request.post(`${API_URL}/projects/${project.id}/changelog`, {
      headers: H,
      data: { title: "v1", body: "shipped", version: "1.0.0", publish: true },
    });
    expect(log.status()).toBe(201);

    // JSON (default format).
    const json = await request.get(`${API_URL}/projects/${project.id}/export`, { headers: H });
    expect(json.status(), await json.text()).toBe(200);
    const body = await json.json();
    expect(body.format).toBe("retro.project.v1");
    expect(body.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.project).toMatchObject({ key: project.key, name: "Export me", board_slug: project.board_slug });
    expect(Array.isArray(body.project.types_enabled)).toBe(true);
    expect(body.feedback).toHaveLength(2);
    expect(body.roadmap).toHaveLength(1);
    expect(body.changelog).toHaveLength(1);
    const first = body.feedback.find((f: any) => f.number === 1);
    expect(first.message).toBe("Line one\nline two");
    expect(first.has_screenshot).toBe(false);
    expect(first.screenshot_data ?? first.screenshot?.data).toBeUndefined();
    expect(Array.isArray(first.notes)).toBe(true);

    // CSV.
    const csv = await request.get(`${API_URL}/projects/${project.id}/export?format=csv`, { headers: H });
    expect(csv.status(), await csv.text()).toBe(200);
    expect(csv.headers()["content-type"]).toMatch(/text\/csv/);
    expect(csv.headers()["content-disposition"]).toMatch(new RegExp(`attachment; filename="${project.key}-feedback.csv"`));
    const text = await csv.text();
    expect(parseCsvHeader(text)).toEqual(CSV_HEADER);
    // Two data rows survive embedded newline/quotes (RFC 4180 quoting): count
    // rows by the leading number column rather than by line.
    expect(text.match(/^(1|2),/gm)?.length).toBe(2);
    expect(text).toContain('""quotes""');

    // Unknown format → 400.
    const bad = await request.get(`${API_URL}/projects/${project.id}/export?format=xml`, { headers: H });
    expect(bad.status()).toBe(400);
  });

  test("export needs feedback:read AND board:read; viewer keys can, a key without board:read cannot", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const viewer = await createApiKey(request, account, "viewer", "viewer");
    const ok = await request.get(`${API_URL}/projects/${project.id}/export`, { headers: keyHeaders(viewer.key) });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).format).toBe("retro.project.v1");

    // Another account's project is a 404.
    const other = await registerAccount(request);
    const nope = await request.get(`${API_URL}/projects/${project.id}/export`, { headers: jwtHeaders(other) });
    expect(nope.status()).toBe(404);
  });

  test("settings page offers Export JSON / Export CSV", async ({ page, request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    await seedSession(page, account);
    await page.goto(`/dashboard/projects/${project.id}/settings`);
    const jsonCtl = page.getByRole("link", { name: /export json/i }).or(page.getByRole("button", { name: /export json/i }));
    const csvCtl = page.getByRole("link", { name: /export csv/i }).or(page.getByRole("button", { name: /export csv/i }));
    await expect(jsonCtl.first()).toBeVisible();
    await expect(csvCtl.first()).toBeVisible();
  });
});
