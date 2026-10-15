import { test, expect } from "@playwright/test";
import { API_URL, createProject, jwtHeaders, listFeedback, patchProject, registerAccount } from "../helpers";

/**
 * Public board: roadmap columns, voting (toggle, idempotent, de-duplicated),
 * published changelog only, and submitting an idea from the board.
 */
test.describe("public board", () => {
  test("@critical renders roadmap + changelog, vote toggles, idea lands in the inbox", async ({ page, request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    await patchProject(request, account, project.id, { board_enabled: true, board_intro: "Tell us what to build." });

    // Seed: one planned item, one hidden item, one draft + one published changelog entry.
    const planned = await request.post(`${API_URL}/projects/${project.id}/roadmap`, {
      headers: jwtHeaders(account),
      data: { title: "Dark mode", description: "A dark theme for night owls." },
    });
    expect(planned.status(), await planned.text()).toBe(201);
    const plannedItem = await planned.json();
    const hidden = await request.post(`${API_URL}/projects/${project.id}/roadmap`, {
      headers: jwtHeaders(account),
      data: { title: "Secret plan", public: false },
    });
    expect(hidden.status()).toBe(201);
    const draft = await request.post(`${API_URL}/projects/${project.id}/changelog`, {
      headers: jwtHeaders(account),
      data: { title: "Unreleased draft", body: "soon" },
    });
    expect(draft.status()).toBe(201);
    const published = await request.post(`${API_URL}/projects/${project.id}/changelog`, {
      headers: jwtHeaders(account),
      data: { title: "Export fixed", body: "## Fixed\n- export button", version: "1.4.1", publish: true },
    });
    expect(published.status()).toBe(201);

    // Public page.
    await page.goto(`/b/${project.board_slug}`);
    await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
    await expect(page.getByText("Tell us what to build.")).toBeVisible();
    await expect(page.getByText("Dark mode")).toBeVisible();
    await expect(page.getByText("Secret plan")).toHaveCount(0);

    // Vote toggles and persists on reload (voter id in localStorage).
    const voteButton = page.getByRole("button", { name: /vote/i }).first();
    await voteButton.click();
    await expect(voteButton).toHaveAttribute("aria-pressed", "true");
    await expect(voteButton).toContainText("1");
    await page.reload();
    await expect(page.getByRole("button", { name: /vote/i }).first()).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /vote/i }).first().click();
    await expect(page.getByRole("button", { name: /vote/i }).first()).toHaveAttribute("aria-pressed", "false");

    // Changelog shows only the published entry.
    await page.goto(`/b/${project.board_slug}/changelog`);
    await expect(page.getByText("Export fixed")).toBeVisible();
    await expect(page.getByText("Unreleased draft")).toHaveCount(0);

    // Submit an idea from the board → arrives as a feature request with source board.
    // The submission form is inline at the bottom of the board (no button to open it).
    await page.goto(`/b/${project.board_slug}`);
    await page.getByLabel(/message|idea|describe/i).first().fill("Please add keyboard shortcuts");
    await page.getByRole("button", { name: /send|submit/i }).last().click();
    await expect(page.getByText(/thank/i)).toBeVisible();

    const inbox = await listFeedback(request, account, project.id);
    expect(inbox.total).toBe(1);
    expect(inbox.items[0]!.type).toBe("feature");
    expect(inbox.items[0]!.source).toBe("board");

    // API side: the vote endpoint is idempotent per voter and the roadmap item exists.
    const voter = crypto.randomUUID();
    const v1 = await request.post(`${API_URL}/boards/${project.board_slug}/items/${plannedItem.id}/vote`, { data: { voter_id: voter } });
    expect(v1.status(), await v1.text()).toBe(200);
    const v2 = await request.post(`${API_URL}/boards/${project.board_slug}/items/${plannedItem.id}/vote`, { data: { voter_id: voter } });
    expect(v2.status()).toBe(200);
    expect((await v1.json()).votes).toBe((await v2.json()).votes);
  });

  test("a disabled board is a 404, and submissions can be switched off", async ({ page, request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);

    expect((await request.get(`${API_URL}/boards/${project.board_slug}`)).status()).toBe(404);
    const res = await page.goto(`/b/${project.board_slug}`);
    expect(res?.status()).toBe(404);

    await patchProject(request, account, project.id, { board_enabled: true, allow_board_submissions: false });
    const blocked = await request.post(`${API_URL}/boards/${project.board_slug}/feedback`, { data: { message: "x" } });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error.code).toBe("submissions_disabled");
  });
});
