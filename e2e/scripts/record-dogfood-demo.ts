/**
 * Dogfood demo: the retro widget running inside retro itself (same chrome and
 * theme/lang preferences as every other 3m4 app). Records a webm + captioned
 * frames; build the GIF with make-gif.py.
 *
 *   cd e2e && E2E_BASE_URL=http://localhost:8082 bun run scripts/record-dogfood-demo.ts [outDir]
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:8082";
const API = `${BASE}/api`;
const OUT = process.argv[2] ?? join(import.meta.dir, "..", "demo-frames-dogfood");
mkdirSync(OUT, { recursive: true });
const frames: { file: string; hold: number }[] = [];
let n = 0;
async function caption(page: Page, text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById("__demo_caption");
    if (!el) { el = document.createElement("div"); el.id = "__demo_caption"; Object.assign(el.style, { position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "99999", padding: "14px 24px", background: "rgba(15,23,42,.92)", color: "#fff", font: "600 20px/1.3 system-ui, sans-serif", textAlign: "center" }); document.body.appendChild(el); }
    el.textContent = t;
  }, text);
}
async function shot(page: Page, text: string, hold = 1600) {
  await caption(page, text); await page.waitForTimeout(250);
  const file = join(OUT, `frame-${String(n++).padStart(3, "0")}.png`);
  await page.screenshot({ path: file }); frames.push({ file, hold }); await page.waitForTimeout(hold);
}

// The local dogfood account owns the project whose key is baked into this build.
const j = async (r: Response) => { const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t}`); return JSON.parse(t); };
const auth = await j(await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "dogfood+local@example.com", password: "Dogfood-Passw0rd!" }) }));
const H = { authorization: `Bearer ${auth.access_token}` };
const projects = await j(await fetch(`${API}/projects`, { headers: H }));
const project = projects.items.find((p: { key: string }) => p.key === "retro-local");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const w = page.locator("retro-widget");

await page.goto(`${BASE}/info/docs`);
await w.getByRole("button", { name: /feedback/i }).waitFor();
await shot(page, "Dogfooding: one script tag adds the retro launcher to the app (here, retro's own docs page)", 2400);
await w.getByRole("button", { name: /feedback/i }).click();
await w.getByRole("dialog").waitFor();
await shot(page, "The panel follows the app's theme and language (3m4.theme / 3m4.lang)", 2200);
await w.getByRole("dialog").getByRole("button", { name: /bug/i }).click();
await w.getByRole("dialog").getByRole("textbox", { name: /message|what happened|describe/i }).pressSequentially("The docs code block overflows on narrow screens.", { delay: 25 });
await w.getByRole("dialog").getByRole("textbox", { name: /email/i }).fill("ana@example.com");
await shot(page, "Report a bug with an optional email (and a screenshot on desktop)", 1800);
await w.getByRole("dialog").getByRole("button", { name: /send|submit/i }).click();
await w.getByRole("dialog").getByText(/#\d+/).waitFor();
await shot(page, "Sent: the reporter gets a ticket number", 2000);

await page.evaluate(() => { localStorage.setItem("3m4.theme", "dark"); });
await page.goto(`${BASE}/`);
await w.getByRole("button", { name: /feedback/i }).click();
await w.getByRole("dialog").waitFor();
await shot(page, "Dark theme: the widget switches with the app", 2200);

await page.evaluate(([a, r]) => { localStorage.setItem("retro_access_token", a); localStorage.setItem("retro_refresh_token", r); localStorage.setItem("3m4.theme", "light"); }, [auth.access_token, auth.refresh_token]);
await page.goto(`${BASE}/dashboard/projects/${project.id}`);
await page.getByText("The docs code block overflows").first().waitFor();
await shot(page, "…and it lands in the project's inbox, source: widget", 2600);

const video = page.video(); await ctx.close(); await browser.close();
if (video) renameSync(await video.path(), join(OUT, "demo.webm"));
writeFileSync(join(OUT, "frames.json"), JSON.stringify(frames, null, 2));
console.log(`captured ${frames.length} frames${video ? " + demo.webm" : ""} in ${OUT}`);
