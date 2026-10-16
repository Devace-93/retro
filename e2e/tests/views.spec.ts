import { test, expect } from "@playwright/test";
import { API_URL, createProject, jwtHeaders, registerAccount, seedSession, type SavedView } from "../helpers";

/**
 * Saved views (CONTRACT.md → Phase 2 addendum → Saved views).
 *
 * UI hooks assumed on /dashboard/projects/[id] (inbox):
 *  - a strip with role="tablist" (or group) named /views/i containing one role="tab" per view
 *    role="button" per view (virtual defaults first: New, Bugs, Features,
 *    Positive, Negative), then the saved ones;
 *  - a button named /save.*view/i that saves the current filters (prompts for
 *    a name through a text box named /name/i inside a dialog).
 * Adjust the regexes if the labels differ.
 */
test.describe("saved views", () => {
  test("@critical CRUD + ordering + per-project limit", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const H = jwtHeaders(account);
    const base = `${API_URL}/projects/${project.id}/views`;

    const empty = await request.get(base, { headers: H });
    expect(empty.status(), await empty.text()).toBe(200);
    expect(await empty.json()).toEqual([]);

    const created = await request.post(base, { headers: H, data: { name: "Hot bugs", filters: { type: "bug", priority: "high", sort: "newest" } } });
    expect(created.status(), await created.text()).toBe(201);
    const view = (await created.json()) as SavedView;
    expect(view.id).toBeTruthy();
    expect(view.name).toBe("Hot bugs");
    expect(view.filters).toMatchObject({ type: "bug", priority: "high" });
    expect(typeof view.position).toBe("number");

    // Unknown filter keys are rejected; empty name is rejected.
    const badKey = await request.post(base, { headers: H, data: { name: "x", filters: { bogus: "1" } } });
    expect(badKey.status()).toBe(400);
    const noName = await request.post(base, { headers: H, data: { name: "  ", filters: {} } });
    expect(noName.status()).toBe(400);

    const second = await request.post(base, { headers: H, data: { name: "Screenshots", filters: { has_screenshot: "true" } } });
    expect(second.status()).toBe(201);
    const v2 = (await second.json()) as SavedView;

    const patched = await request.patch(`${base}/${view.id}`, { headers: H, data: { name: "Hot bugs!", position: 1 } });
    expect(patched.status(), await patched.text()).toBe(200);
    expect((await patched.json()).name).toBe("Hot bugs!");

    const list = (await (await request.get(base, { headers: H })).json()) as SavedView[];
    expect(list.map((v) => v.name)).toEqual(["Screenshots", "Hot bugs!"]);

    const del = await request.delete(`${base}/${v2.id}`, { headers: H });
    expect(del.status()).toBe(204);
    const after = (await (await request.get(base, { headers: H })).json()) as SavedView[];
    expect(after.map((v) => v.id)).toEqual([view.id]);

    // Limit: 20 per project → 400 too_many_views.
    for (let i = after.length; i < 20; i++) {
      const r = await request.post(base, { headers: H, data: { name: `v${i}`, filters: { status: "new" } } });
      expect(r.status(), `view ${i}: ${await r.text()}`).toBe(201);
    }
    const over = await request.post(base, { headers: H, data: { name: "one too many", filters: {} } });
    expect(over.status(), await over.text()).toBe(400);
    expect((await over.json()).error.code).toBe("too_many_views");

    // Foreign project → 404.
    const other = await registerAccount(request);
    const nope = await request.get(base, { headers: jwtHeaders(other) });
    expect(nope.status()).toBe(404);
  });

  test("inbox shows the virtual defaults and a saved view, and applies it", async ({ page, request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const H = jwtHeaders(account);
    await request.post(`${API_URL}/projects/${project.id}/views`, { headers: H, data: { name: "Hot bugs", filters: { type: "bug" } } });
    await request.post(`${API_URL}/ingest/feedback`, { headers: { "X-Project-Key": project.public_key }, data: { type: "bug", message: "a bug" } });
    await request.post(`${API_URL}/ingest/feedback`, { headers: { "X-Project-Key": project.public_key }, data: { type: "feature", message: "a feature" } });

    await seedSession(page, account);
    await page.goto(`/dashboard/projects/${project.id}`);
    const strip = page.getByRole("tablist", { name: /views/i }).or(page.getByRole("group", { name: /views/i }));
    await expect(strip.first()).toBeVisible();
    for (const name of [/^new$/i, /^bugs$/i, /^features$/i, /^positive$/i, /^negative$/i, /hot bugs/i]) {
      await expect(strip.first().getByRole("tab", { name })).toBeVisible();
    }
    await strip.first().getByRole("tab", { name: /hot bugs/i }).click();
    await expect(page.getByText("a bug").first()).toBeVisible();
    await expect(page.getByText("a feature").first()).toHaveCount(0);
  });
});
