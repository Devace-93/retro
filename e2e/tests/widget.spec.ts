import { test, expect, type Page } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { createProject, listFeedback, registerAccount, WIDGET_URL } from "../helpers";

/**
 * The embeddable widget on a third-party-looking host page. The page is served
 * from the app origin (page.setContent keeps about:blank, so we route a fake
 * host URL instead) and loads /widget.js from the running stack; the widget
 * calls the API cross-origin exactly like a customer site would.
 */
// A loopback origin that is NOT the app: Chrome blocks public-origin pages from
// fetching loopback resources (Private Network Access), so a host.example page
// could never load /widget.js from localhost. page.route serves it, port unused.
const HOST_URL = "http://127.0.0.1:9/app/editor";

function hostPage(projectKey: string, extraAttrs = ""): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Host app</title></head>
<body>
  <h1>Host app</h1>
  <script src="${WIDGET_URL}" data-project-key="${projectKey}" data-api="${BASE_URL}/api" ${extraAttrs} defer></script>
</body></html>`;
}

async function serveHost(page: Page, html: string): Promise<void> {
  await page.route(HOST_URL, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto(HOST_URL);
}

/** Everything the widget renders lives in a shadow root; Playwright pierces it. */
function widget(page: Page) {
  return page.locator("retro-widget");
}

test.describe("widget", () => {
  test("@critical open, pick bug, type, submit, success state; item lands in the inbox", async ({ page, request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    await serveHost(page, hostPage(project.public_key));

    const w = widget(page);
    await expect(w).toHaveCount(1);
    const launcher = w.getByRole("button", { name: /feedback/i });
    await expect(launcher).toBeVisible();
    await launcher.click();

    const dialog = w.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /bug/i }).click();
    await dialog.getByRole("textbox", { name: /message|what happened|describe/i }).fill("The save button crashes the editor");
    await dialog.getByRole("textbox", { name: /email/i }).fill("reporter@example.com");
    await dialog.getByRole("button", { name: /send|submit/i }).click();

    await expect(dialog.getByText(/#1\b/)).toBeVisible();
    await expect(dialog.getByText(/thank/i)).toBeVisible();

    const inbox = await listFeedback(request, account, project.id);
    expect(inbox.total).toBe(1);
    const item = inbox.items[0]!;
    expect(item.type).toBe("bug");
    expect(item.message).toBe("The save button crashes the editor");
    expect(item.source).toBe("widget");

    // Escape closes the panel.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("headless API: retro.open / identify / setMeta / submitted event", async ({ page, request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    await serveHost(page, hostPage(project.public_key, 'data-hide-launcher="true"'));

    const w = widget(page);
    await expect(w).toHaveCount(1);
    await expect(w.getByRole("button", { name: /feedback/i })).toHaveCount(0);

    await page.waitForFunction(() => typeof (window as any).retro?.open === "function");
    await page.evaluate(() => {
      const r = (window as any).retro;
      r.identify({ id: "user-42", email: "known@example.com" });
      r.setMeta({ plan: "pro" });
      (window as any).__submitted = null;
      r.on("submitted", (ev: unknown) => ((window as any).__submitted = ev));
      r.open({ type: "feature" });
    });

    const dialog = w.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: /email/i })).toHaveValue("known@example.com");
    await dialog.getByRole("textbox", { name: /message|what happened|describe/i }).fill("Keyboard shortcuts please");
    await dialog.getByRole("button", { name: /send|submit/i }).click();
    await expect(dialog.getByText(/#1\b/)).toBeVisible();

    const submitted = await page.evaluate(() => (window as any).__submitted);
    expect(submitted).toMatchObject({ number: 1 });

    const inbox = await listFeedback(request, account, project.id);
    expect(inbox.items[0]!.type).toBe("feature");
  });

  test("respects the project's enabled types and never throws into the host page", async ({ page, request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    await request.patch(`${BASE_URL}/api/projects/${project.id}`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      data: { types_enabled: ["feedback"] },
    });

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await serveHost(page, hostPage(project.public_key));

    const w = widget(page);
    await w.getByRole("button", { name: /feedback/i }).click();
    const dialog = w.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^bug/i })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /thumbs up|👍|positive/i })).toBeVisible();
    expect(errors).toEqual([]);

    // A bad key degrades gracefully: launcher may hide or the panel shows an error, but no page error.
    await serveHost(page, hostPage("retro_pub_invalid"));
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});
