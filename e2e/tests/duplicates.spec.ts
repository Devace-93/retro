import { test, expect } from "@playwright/test";
import { API_URL, createProject, getFeedback, ingest, jwtHeaders, listFeedback, registerAccount, seedSession } from "../helpers";

/**
 * Duplicate detection + merge (CONTRACT.md → Phase 2 addendum → Duplicate
 * detection). Similarity is pg_trgm on message text, threshold 0.45, same
 * type, last 90 days, not declined.
 *
 * UI hooks assumed in the inbox detail drawer (/dashboard/projects/[id],
 * click an item): a section headed /possible duplicates/i listing "#<n>" with
 * a button named /merge into #<n>/i; merged items show a badge
 * /duplicate of #<n>/i. Adjust if the labels differ.
 */
const ORIGINAL = "The export button does nothing on Firefox, I click it and the spinner never stops";
const NEAR = "Export button does nothing on Firefox: click it and the spinner never stops spinning";
const UNRELATED = "Please add a dark mode toggle to the editor settings page";

test.describe("duplicates", () => {
  test("@critical a near-identical message is flagged; merge marks it duplicate_of and hides it", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const H = jwtHeaders(account);

    const a = await ingest(request, project.public_key, { type: "bug", message: ORIGINAL, email: "first@example.com" });
    const unrelated = await ingest(request, project.public_key, { type: "bug", message: UNRELATED });
    const otherType = await ingest(request, project.public_key, { type: "feature", message: NEAR }); // same text, other type → never similar
    const b = await ingest(request, project.public_key, { type: "bug", message: NEAR, email: "second@example.com" });
    for (const r of [a, unrelated, otherType, b]) expect(r.status).toBe(201);

    const detail = await getFeedback(request, account, project.id, b.body.id);
    expect(detail.similar, "similar should be present on detail").toBeDefined();
    const ids = (detail.similar ?? []).map((s) => s.id);
    expect(ids).toContain(a.body.id);
    expect(ids).not.toContain(unrelated.body.id);
    expect(ids).not.toContain(otherType.body.id);
    const match = detail.similar!.find((s) => s.id === a.body.id)!;
    expect(match.number).toBe(a.body.number);
    expect(match.similarity).toBeGreaterThanOrEqual(0.45);
    expect(match.similarity).toBeLessThanOrEqual(1);
    expect(detail.duplicate_of ?? null).toBeNull();

    // Tag the duplicate so we can see tags copied on merge.
    const tagged = await request.patch(`${API_URL}/projects/${project.id}/feedback/${b.body.id}`, { headers: H, data: { tags: ["firefox"] } });
    expect(tagged.status()).toBe(200);

    // Merge b into a.
    const merged = await request.post(`${API_URL}/projects/${project.id}/feedback/${b.body.id}/merge`, { headers: H, data: { into: a.body.id } });
    expect(merged.status(), await merged.text()).toBe(200);
    const mergedBody = await merged.json();
    expect(mergedBody.status).toBe("declined");
    expect(mergedBody.duplicate_of).toBe(a.body.id);

    const target = await getFeedback(request, account, project.id, a.body.id);
    expect(target.tags).toContain("firefox");
    expect((target.notes ?? []).some((n) => /merged #\d+/i.test(n.body))).toBe(true);
    expect((target as any).watchers ?? []).toContain("second@example.com");

    // Cannot merge into itself, into another project, or a second time.
    const self = await request.post(`${API_URL}/projects/${project.id}/feedback/${a.body.id}/merge`, { headers: H, data: { into: a.body.id } });
    expect(self.status()).toBe(400);
    const otherProject = await createProject(request, account);
    const foreign = await ingest(request, otherProject.public_key, { type: "bug", message: "elsewhere" });
    const cross = await request.post(`${API_URL}/projects/${project.id}/feedback/${unrelated.body.id}/merge`, { headers: H, data: { into: foreign.body.id } });
    expect(cross.status()).toBe(404);

    // duplicates=hide filters merged items out; default shows them.
    const shown = await listFeedback(request, account, project.id);
    expect(shown.items.map((i) => i.id)).toContain(b.body.id);
    const hidden = await listFeedback(request, account, project.id, { duplicates: "hide" });
    expect(hidden.items.map((i) => i.id)).not.toContain(b.body.id);
    expect(hidden.total).toBe(shown.total - 1);

    // Declined items are never suggested as similar for newer ones.
    const c = await ingest(request, project.public_key, { type: "bug", message: NEAR + " again" });
    const cDetail = await getFeedback(request, account, project.id, c.body.id);
    expect((cDetail.similar ?? []).map((s) => s.id)).not.toContain(b.body.id);
    expect((cDetail.similar ?? []).map((s) => s.id)).toContain(a.body.id);
  });

  test("drawer shows possible duplicates and merges from the UI", async ({ page, request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const a = await ingest(request, project.public_key, { type: "bug", message: ORIGINAL });
    const b = await ingest(request, project.public_key, { type: "bug", message: NEAR });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    await seedSession(page, account);
    await page.goto(`/dashboard/projects/${project.id}`);
    await page.getByText(NEAR.slice(0, 40)).first().click();
    const dup = page.getByText(/possible duplicates/i);
    await expect(dup).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`merge into #${a.body.number}`, "i") }).click();
    await expect(page.getByText(new RegExp(`duplicate of #${a.body.number}`, "i")).first()).toBeVisible();

    const detail = await getFeedback(request, account, project.id, b.body.id);
    expect(detail.duplicate_of).toBe(a.body.id);
  });
});
