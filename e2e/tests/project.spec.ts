import { test, expect } from "@playwright/test";
import { API_URL, jwtHeaders, registerAccount, seedSession, uniqueName } from "../helpers";

/**
 * Create a project in the dashboard → its settings show the public key and the
 * install snippet → enable the public board → the board URL goes live.
 */
test.describe("projects", () => {
  test("@critical create a project, read its public key, enable the board", async ({ page, request }) => {
    const account = await registerAccount(request);
    await seedSession(page, account);
    const name = uniqueName();

    await page.goto("/dashboard");
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel(/name/i).fill(name);
    await page.getByRole("button", { name: /^create/i }).click();

    // Lands on the project (inbox) page; go to settings.
    await expect(page).toHaveURL(/\/dashboard\/projects\/[0-9a-f-]+/);
    // Creating lands on the project settings page; derive the project id from the URL.
    const projectId = page.url().match(/\/dashboard\/projects\/([0-9a-f-]+)/)![1];
    const projectUrl = `/dashboard/projects/${projectId}`;
    await page.goto(`${projectUrl}/settings`);

    // Public key + snippet with the real key.
    const key = page.getByTestId("public-key");
    await expect(key).toBeVisible();
    const publicKey = ((await key.textContent()) ?? "").trim();
    expect(publicKey).toMatch(/^retro_pub_/);
    await expect(page.locator("pre, code").filter({ hasText: publicKey }).first()).toBeVisible();
    await expect(page.locator("pre, code").filter({ hasText: "widget.js" }).first()).toBeVisible();

    // Enable the public board.
    const boardToggle = page.getByRole("switch", { name: /board enabled/i });
    await expect(boardToggle).toHaveAttribute("aria-checked", "false");
    await boardToggle.click();
    await expect(boardToggle).toHaveAttribute("aria-checked", "true");

    // The API agrees and the board answers.
    const res = await request.get(`${API_URL}/projects/${projectId}`, { headers: jwtHeaders(account) });
    expect(res.status()).toBe(200);
    const project = await res.json();
    expect(project.board_enabled).toBe(true);
    expect(project.public_key).toBe(publicKey);
    const board = await request.get(`${API_URL}/boards/${project.board_slug}`);
    expect(board.status(), await board.text()).toBe(200);
  });

  test("a project of another account is a 404, never a 403", async ({ request }) => {
    const owner = await registerAccount(request);
    const other = await registerAccount(request);
    const created = await request.post(`${API_URL}/projects`, { headers: jwtHeaders(owner), data: { name: uniqueName() } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const res = await request.get(`${API_URL}/projects/${id}`, { headers: jwtHeaders(other) });
    expect(res.status()).toBe(404);
  });
});
