import { test, expect } from "@playwright/test";
import { API_URL, createProject, ingest, patchProject, registerAccount } from "../helpers";

/**
 * Cloudflare Turnstile per project (CONTRACT.md → Phase 2 addendum → Spam
 * protection). We never reach Cloudflare: a missing token must already fail
 * with 400 captcha_failed, and a bogus token is rejected by siteverify (or,
 * on a verification outage, accepted and tagged `unverified`).
 * No UI locators in this file.
 */
const SITE_KEY = "1x00000000000000000000AA"; // Cloudflare's documented "always passes" test site key
const SECRET = "1x0000000000000000000000000000000AA"; // matching test secret

test.describe("turnstile", () => {
  test("@critical configured project requires a token; clearing both keys restores plain ingest", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);

    // Secret is write-only; responses only expose turnstile_enabled + site key.
    const on = await patchProject(request, account, project.id, { turnstile_site_key: SITE_KEY, turnstile_secret: SECRET });
    expect((on as any).turnstile_enabled).toBe(true);
    expect((on as any).turnstile_site_key).toBe(SITE_KEY);
    expect((on as any).turnstile_secret).toBeUndefined();

    // Widget config advertises the site key.
    const cfg = await request.get(`${API_URL}/ingest/config`, { headers: { "X-Project-Key": project.public_key } });
    expect(cfg.status()).toBe(200);
    expect((await cfg.json()).turnstile_site_key).toBe(SITE_KEY);

    // No token → 400 captcha_failed, nothing stored.
    const noToken = await ingest(request, project.public_key, { type: "bug", message: "no captcha" });
    expect(noToken.status, JSON.stringify(noToken.body)).toBe(400);
    expect(noToken.body.error.code).toBe("captcha_failed");

    // Board submissions follow the same rule.
    await patchProject(request, account, project.id, { board_enabled: true });
    const boardNoToken = await request.post(`${API_URL}/boards/${project.board_slug}/feedback`, { data: { message: "idea without captcha" } });
    expect(boardNoToken.status()).toBe(400);
    expect((await boardNoToken.json()).error.code).toBe("captcha_failed");

    // A token is sent: with Cloudflare's test keys siteverify accepts anything,
    // on an outage the contract says accept + tag `unverified`. Either way: 201.
    const withToken = await ingest(request, project.public_key, { type: "bug", message: "with captcha", turnstile_token: "XXXX.DUMMY.TOKEN.XXXX" });
    expect(withToken.status, JSON.stringify(withToken.body)).toBe(201);

    // Half-configured (site key without secret) counts as disabled.
    const half = await patchProject(request, account, project.id, { turnstile_secret: "" });
    expect((half as any).turnstile_enabled).toBe(false);

    // Clear both → plain ingest again, config no longer advertises a key.
    const off = await patchProject(request, account, project.id, { turnstile_site_key: null, turnstile_secret: null });
    expect((off as any).turnstile_enabled).toBe(false);
    const plain = await ingest(request, project.public_key, { type: "bug", message: "plain again" });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    const cfg2 = await (await request.get(`${API_URL}/ingest/config`, { headers: { "X-Project-Key": project.public_key } })).json();
    expect(cfg2.turnstile_site_key ?? null).toBeNull();
  });
});
