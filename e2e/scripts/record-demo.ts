/**
 * Scripted product demo for retro: seeds a project through the API, then
 * drives the running local stack with Playwright, recording a webm (built-in
 * recorder) and captioned still frames. `make-gif.py` turns the frames into a
 * GIF for the PR description.
 *
 *   cd e2e && E2E_BASE_URL=http://localhost:8082 bun run scripts/record-demo.ts [outDir]
 *   uv run --with pillow e2e/scripts/make-gif.py e2e/demo-frames docs/pr/<topic>.gif 960
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8082";
const API = `${BASE}/api`;
const OUT = process.argv[2] ?? join(import.meta.dir, "..", "demo-frames");
mkdirSync(OUT, { recursive: true });

const frames: { file: string; hold: number }[] = [];
let n = 0;

async function caption(page: Page, text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById("__demo_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_caption";
      Object.assign(el.style, {
        position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "99999",
        padding: "14px 24px", background: "rgba(15,23,42,.92)", color: "#fff",
        font: "600 20px/1.3 system-ui, sans-serif", textAlign: "center",
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

/** Capture one frame; `hold` is how long the GIF shows it (ms). */
async function shot(page: Page, text: string, hold = 1600) {
  await caption(page, text);
  await page.waitForTimeout(250);
  const file = join(OUT, `frame-${String(n++).padStart(3, "0")}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, hold });
  await page.waitForTimeout(hold);
}

/** A step that must not abort the recording if a selector drifted. */
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { console.warn(`[demo] step skipped: ${name}: ${(e as Error).message.split("\n")[0]}`); }
}

// ---------------------------------------------------------------------------
// Seed through the API (fast and deterministic).
// ---------------------------------------------------------------------------
const j = async (r: Response) => { const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t}`); return t ? JSON.parse(t) : null; };
const ts = Date.now().toString(36);
const auth = await j(await fetch(`${API}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `demo+${ts}@example.com`, password: "Demo-Passw0rd!", account_name: "Enrique" }) }));
const H = { "content-type": "application/json", authorization: `Bearer ${auth.access_token}` };
const project = await j(await fetch(`${API}/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "Kinegram Generator", url: "https://kinegram.3m4.net" }) }));
await j(await fetch(`${API}/projects/${project.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ board_enabled: true, board_intro: "Vote for what we should build next." }) }));
const ingest = async (body: Record<string, unknown>) =>
  j(await fetch(`${API}/ingest/feedback`, { method: "POST", headers: { "content-type": "application/json", "x-project-key": project.public_key, "x-retro-source": "widget" }, body: JSON.stringify({ page_url: "https://kinegram.3m4.net/editor", app_version: "1.4.0", ...body }) }));
await ingest({ type: "bug", message: "The export button does nothing on Firefox 131. The spinner shows and then nothing happens.", email: "ana@example.com" });
await ingest({ type: "feedback", sentiment: "positive", message: "Love the new editor, the grid snapping is perfect!" });
await ingest({ type: "feature", message: "Please add a dark mode toggle for the editor." });
await ingest({ type: "bug", message: "Export button does nothing on Firefox. I click it, the spinner shows, nothing happens.", email: "luis@example.com" });
await j(await fetch(`${API}/projects/${project.id}/feedback/3/promote`, { method: "POST", headers: H, body: "{}" }));
await j(await fetch(`${API}/projects/${project.id}/changelog`, { method: "POST", headers: H, body: JSON.stringify({ title: "Grid snapping", body: "## New\n- Snap to grid in the editor", version: "1.4.0", publish: true }) }));

// ---------------------------------------------------------------------------
// Record.
// ---------------------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();

await page.goto(`${BASE}/`);
await page.waitForTimeout(800);
await shot(page, "retro: open-source user feedback — widget, API, public roadmap, MCP server", 2400);

await page.goto(`${BASE}/login`);
await page.evaluate(([a, r]) => { localStorage.setItem("retro_access_token", a); localStorage.setItem("retro_refresh_token", r); }, [auth.access_token, auth.refresh_token]);

const inbox = `${BASE}/dashboard/projects/${project.id}`;
await step("inbox", async () => {
  await page.goto(inbox);
  await page.waitForSelector('[data-testid="views"]');
  await page.waitForTimeout(500);
  await shot(page, "Phase 2: the inbox gets saved views, duplicate detection, replies, webhooks, export", 2400);
  await page.getByRole("tab", { name: /^bugs$/i }).click();
  await page.waitForTimeout(600);
  await shot(page, "Views strip: virtual defaults (New, Bugs, Features…) plus views you save from any filter combination", 2400);
});

await step("duplicates + merge", async () => {
  await page.getByText("Export button does nothing on Firefox. I click it").first().click();
  await page.waitForSelector("text=/possible duplicates/i");
  await page.waitForTimeout(400);
  await shot(page, "Duplicate detection (pg_trgm): similar reports surface in the drawer with a similarity score", 2600);
  await page.getByRole("button", { name: /merge into #1/i }).click();
  await page.waitForTimeout(300);
  await shot(page, "Merge is two-step: arm, then confirm", 1400);
  await page.getByRole("button", { name: /^confirm$/i }).click();
  await page.waitForSelector("text=/duplicate of #1/i");
  await page.waitForTimeout(400);
  await shot(page, "Merged: declined as a duplicate of #1, tags and reporter carried over to the original", 2600);
});

await step("reply composer", async () => {
  await page.goto(inbox);
  await page.getByRole("tab", { name: /^all$/i }).click();
  await page.getByText("The export button does nothing on Firefox 131").first().click();
  await page.waitForSelector("text=/reply to the reporter/i");
  await page.locator("text=/reply to the reporter/i").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "Reply to the reporter by email (outbox worker, Reply-To = you). Disabled here: no SMTP configured", 2600);
});

await step("webhooks", async () => {
  await page.goto(`${inbox}/settings`);
  await page.waitForSelector("text=/^webhooks$/i");
  await page.locator("text=/^webhooks$/i").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "Webhooks per project: feedback.created, status changes, changelog.published, with HMAC signatures and retries", 2400);
  await page.getByLabel(/endpoint url/i).fill("https://hooks.example.com/retro");
  await page.getByRole("button", { name: /add webhook/i }).click();
  await page.waitForSelector("text=/copy the signing secret now/i");
  await page.waitForTimeout(400);
  await shot(page, "The signing secret is shown once; deliveries and attempts are visible per webhook", 2600);
});

await step("spam + export", async () => {
  await page.locator("text=/spam protection/i").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "Optional Cloudflare Turnstile on the widget and the board form; Export JSON / CSV of everything", 2600);
});

await step("notifications", async () => {
  await page.goto(`${BASE}/dashboard/settings`);
  await page.waitForSelector("text=/notifications/i");
  await page.locator("text=/notifications/i").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "Email digests of new feedback: instant, 15 min, hourly or daily", 2200);
});

await step("board", async () => {
  await page.goto(`${BASE}/b/${project.board_slug}`);
  await page.waitForSelector("text=/roadmap/i");
  await page.waitForTimeout(500);
  await shot(page, "The public board is unchanged for visitors — Turnstile appears only when you configure it", 2400);
});

await step("docs", async () => {
  await page.goto(`${BASE}/info/docs`);
  await page.locator("text=/webhook/i").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "Docs: payloads, headers, signature verification in Node and Python", 2600);
});

const video = page.video();
await ctx.close();
await browser.close();
if (video) renameSync(await video.path(), join(OUT, "demo.webm"));
writeFileSync(join(OUT, "frames.json"), JSON.stringify(frames, null, 2));
console.log(`captured ${frames.length} frames${video ? " + demo.webm" : ""} in ${OUT}`);
