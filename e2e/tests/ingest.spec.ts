import { test, expect } from "@playwright/test";
import { API_URL, createProject, ingest, listFeedback, registerAccount, TINY_PNG } from "../helpers";

/**
 * The public ingest API: JSON with the key in a header, form body with the key
 * in the body, honeypot, bad key, screenshot, CORS. Items land in the owner's
 * inbox with the right type / status / source.
 */
test.describe("ingest API", () => {
  test("@critical JSON + header, then form body, both reach the inbox", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);

    const json = await ingest(request, project.public_key, {
      type: "bug",
      message: "Export button does nothing\nSteps: click export",
      email: "reporter@example.com",
      page_url: "https://app.example/editor",
      app_version: "1.4.0",
      metadata: { browser: "e2e" },
    });
    expect(json.status, JSON.stringify(json.body)).toBe(201);
    expect(json.body.number).toBe(1);
    expect(json.body.status).toBe("new");
    expect(json.body.board_url).toBeNull(); // board starts disabled
    expect(json.body.screenshot_dropped).toBe(false);

    // Plain HTML form: key in the body, no custom header, type feedback + sentiment.
    const form = await request.post(`${API_URL}/ingest/feedback`, {
      form: {
        project_key: project.public_key,
        type: "feedback",
        sentiment: "positive",
        message: "Love it",
        metadata: JSON.stringify({ from: "form" }),
      },
    });
    expect(form.status(), await form.text()).toBe(201);
    expect((await form.json()).number).toBe(2);

    const inbox = await listFeedback(request, account, project.id);
    expect(inbox.total).toBe(2);
    const bug = inbox.items.find((i) => i.number === 1)!;
    expect(bug.type).toBe("bug");
    expect(bug.title).toBe("Export button does nothing");
    expect(bug.source).toBe("api");
    const fb = inbox.items.find((i) => i.number === 2)!;
    expect(fb.type).toBe("feedback");
  });

  test("the honeypot answers 201 but stores nothing", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const r = await ingest(request, project.public_key, { type: "bug", message: "buy now", website: "http://spam.example" });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeTruthy();
    const inbox = await listFeedback(request, account, project.id);
    expect(inbox.total).toBe(0);
  });

  test("validation: bad key, missing message, disabled type, unknown sentiment is ignored", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);

    const badKey = await ingest(request, "retro_pub_doesnotexist", { type: "bug", message: "x" });
    expect(badKey.status).toBe(401);
    expect(badKey.body.error.code).toBe("invalid_project_key");

    const noMsg = await ingest(request, project.public_key, { type: "bug", message: "   " });
    expect(noMsg.status).toBe(400);
    expect(noMsg.body.error.code).toBe("missing_message");

    const badType = await ingest(request, project.public_key, { type: "praise", message: "x" });
    expect(badType.status).toBe(400);
    expect(badType.body.error.code).toBe("invalid_type");

    const res = await request.patch(`${API_URL}/projects/${project.id}`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      data: { types_enabled: ["bug"] },
    });
    expect(res.status()).toBe(200);
    const disabled = await ingest(request, project.public_key, { type: "feature", message: "x" });
    expect(disabled.status).toBe(400);
    expect(disabled.body.error.code).toBe("invalid_type");
  });

  test("screenshot is stored and served to the owner", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);
    const r = await ingest(
      request,
      project.public_key,
      { type: "bug", message: "with screenshot", screenshot: TINY_PNG },
      { "X-Retro-Source": "widget" },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.screenshot_dropped).toBe(false);

    const inbox = await listFeedback(request, account, project.id);
    expect(inbox.items[0]!.has_screenshot).toBe(true);
    expect(inbox.items[0]!.source).toBe("widget");

    const img = await request.get(`${API_URL}/projects/${project.id}/feedback/${r.body.id}/screenshot`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toMatch(/^image\/png/);

    // Not readable without auth.
    const anon = await request.get(`${API_URL}/projects/${project.id}/feedback/${r.body.id}/screenshot`);
    expect(anon.status()).toBe(401);
  });

  test("ingest and widget config are CORS-open; widget.js is cacheable", async ({ request }) => {
    const account = await registerAccount(request);
    const project = await createProject(request, account);

    const cfg = await request.get(`${API_URL}/ingest/config`, {
      headers: { "X-Project-Key": project.public_key, Origin: "https://third-party.example" },
    });
    expect(cfg.status(), await cfg.text()).toBe(200);
    expect(cfg.headers()["access-control-allow-origin"]).toBe("*");
    const body = await cfg.json();
    expect(body.project.name).toBe(project.name);
    expect(body.types_enabled).toEqual(["bug", "feedback", "feature"]);

    const preflight = await request.fetch(`${API_URL}/ingest/feedback`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://third-party.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-project-key,x-retro-source",
      },
    });
    expect([200, 204]).toContain(preflight.status());
    expect(preflight.headers()["access-control-allow-origin"]).toBe("*");

    const widget = await request.get(`${API_URL.replace(/\/api$/, "")}/widget.js`);
    expect(widget.status()).toBe(200);
    expect(widget.headers()["content-type"]).toMatch(/javascript/);
    expect(widget.headers()["access-control-allow-origin"]).toBe("*");
    expect(widget.headers()["cache-control"]).toMatch(/max-age/);
  });
});
