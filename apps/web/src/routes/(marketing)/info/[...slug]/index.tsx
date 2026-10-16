import { component$, useContext } from "@builder.io/qwik";
import { useLocation, Link, type DocumentHead } from "@builder.io/qwik-city";
import { PricingTable } from "../../../../components/pricing-table";
import { FeaturesContext } from "../../../../lib/features";
import { tr, useI18n } from "../../../../i18n";
import type { CatalogKey } from "../../../../i18n/catalog/en";

const APP_URL = (import.meta.env.VITE_APP_URL || "https://retro.3m4.net").replace(/\/$/, "");
const CONTRACT_URL = "https://github.com/Devace-93/retro/blob/main/CONTRACT.md";
const MCP_SNIPPET = "claude mcp add retro --scope user --env RETRO_API_KEY=retro_live_… -- npx -y retro-feedback-mcp";
const MCP_REMOTE_SNIPPET = `claude mcp add --transport http retro ${APP_URL}/mcp --header "Authorization: Bearer retro_live_…"`;

const WIDGET_SCRIPT = `<script src="${APP_URL}/widget.js" data-project-key="retro_pub_…" defer></script>`;
const WIDGET_ELEMENT = `<script src="${APP_URL}/widget.js" defer></script>
<retro-widget project-key="retro_pub_…" position="bottom-right" lang="auto" theme="auto"></retro-widget>`;
const WIDGET_JS = `// Headless: your own button, your own metadata
retro.identify({ id: user.id, email: user.email });
retro.setMeta({ plan: "pro", build: "1.4.0" });
retro.on("submitted", ({ number }) => toast(\`Thanks! Ticket #\${number}\`));
document.querySelector("#report-bug").onclick = () => retro.open({ type: "bug" });`;
const CURL_INGEST = `curl -X POST ${APP_URL}/api/ingest/feedback \\
  -H "X-Project-Key: retro_pub_…" -H "Content-Type: application/json" \\
  -d '{
    "type": "bug",
    "message": "The export button does nothing on Safari 17",
    "email": "ana@example.com",
    "page_url": "https://myapp.example.com/editor",
    "app_version": "1.4.0",
    "metadata": { "browser": "Safari 17" }
  }'`;
const FORM_SNIPPET = `<form method="post" action="${APP_URL}/api/ingest/feedback">
  <input type="hidden" name="project_key" value="retro_pub_…">
  <input type="hidden" name="type" value="feedback">
  <textarea name="message" required></textarea>
  <input type="email" name="email" placeholder="Email (optional)">
  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off">
  <button>Send</button>
</form>`;

const WEBHOOK_PAYLOAD = `{
  "id": "6f1c…",                       // delivery id (X-Retro-Delivery)
  "event": "feedback.created",
  "created_at": "2026-10-16T09:12:00Z",
  "project": { "id": "…", "key": "my-app", "name": "My app" },
  "data": { "number": 42, "type": "bug", "title": "Export does nothing", "status": "new", "previous_status": null, … }
}`;
const WEBHOOK_VERIFY_NODE = `import { createHmac, timingSafeEqual } from "node:crypto";

app.post("/hooks/retro", express.raw({ type: "*/*" }), (req, res) => {
  const expected = "sha256=" + createHmac("sha256", process.env.RETRO_WEBHOOK_SECRET).update(req.body).digest("hex");
  const given = req.get("X-Retro-Signature") ?? "";
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return res.sendStatus(401);
  const event = JSON.parse(req.body);          // use event.id to de-duplicate retries
  res.sendStatus(204);
});`;
const WEBHOOK_VERIFY_PY = `import hmac, hashlib
from flask import request, abort

@app.post("/hooks/retro")
def retro_hook():
    expected = "sha256=" + hmac.new(SECRET.encode(), request.get_data(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("X-Retro-Signature", ""), expected):
        abort(401)
    event = request.get_json()               # event["id"] de-duplicates retries
    return "", 204`;

interface Endpoint {
  method: string;
  path: string;
  scope: string;
  notes?: string;
}

const SECTIONS: { title: CatalogKey; body: CatalogKey; endpoints: Endpoint[]; snippet?: string }[] = [
  {
    title: "docs.projectsTitle",
    body: "docs.projectsBody",
    endpoints: [
      { method: "GET", path: "/projects?q=", scope: "projects:read" },
      { method: "POST", path: "/projects", scope: "projects:write", notes: "{name, key?, description?, url?} → 201 · 402 limit_reached" },
      { method: "GET", path: "/projects/:id", scope: "projects:read" },
      { method: "PATCH", path: "/projects/:id", scope: "projects:write", notes: "name, url, board_slug, board_enabled, types_enabled, …" },
      { method: "DELETE", path: "/projects/:id", scope: "projects:delete", notes: "cascades" },
      { method: "POST", path: "/projects/:id/rotate-key", scope: "projects:write", notes: "old public key stops immediately" },
      { method: "GET", path: "/projects/:id/summary", scope: "feedback:read", notes: "counts by status / type / sentiment" },
    ],
    snippet: `curl -X POST ${APP_URL}/api/projects \\
  -H "X-API-Key: retro_live_…" -H "Content-Type: application/json" \\
  -d '{"name": "My app", "url": "https://myapp.example.com"}'`,
  },
  {
    title: "docs.feedbackTitle",
    body: "docs.feedbackBody",
    endpoints: [
      { method: "GET", path: "/projects/:id/feedback?q=&type=&status=&sentiment=&priority=&tag=&page=&sort=", scope: "feedback:read", notes: "comma-separated lists for type/status" },
      { method: "GET", path: "/projects/:id/feedback/:item", scope: "feedback:read", notes: ":item = UUID or #number" },
      { method: "PATCH", path: "/projects/:id/feedback/:item", scope: "feedback:write", notes: "{status?, priority?, tags?, title?, type?, sentiment?, roadmap_item_id?}" },
      { method: "POST", path: "/projects/:id/feedback/:item/notes", scope: "feedback:write", notes: "{body}" },
      { method: "POST", path: "/projects/:id/feedback/:item/promote", scope: "feedback:write + board:write", notes: "→ roadmap item, idempotent" },
      { method: "GET", path: "/projects/:id/feedback/:item/screenshot", scope: "feedback:read", notes: "image bytes" },
      { method: "DELETE", path: "/projects/:id/feedback/:item", scope: "feedback:delete" },
    ],
    snippet: `curl -X PATCH ${APP_URL}/api/projects/$PROJECT/feedback/42 \\
  -H "X-API-Key: retro_live_…" -H "Content-Type: application/json" \\
  -d '{"status": "triaged", "priority": "high", "tags": ["export", "safari"]}'`,
  },
  {
    title: "docs.boardTitle",
    body: "docs.boardBody",
    endpoints: [
      { method: "GET", path: "/projects/:id/roadmap?status=", scope: "board:read" },
      { method: "POST", path: "/projects/:id/roadmap", scope: "board:write", notes: "{title, description?, status?, public?} · 402" },
      { method: "PATCH", path: "/projects/:id/roadmap/:rid", scope: "board:write", notes: "done ⇒ completed_at; linked feedback follows" },
      { method: "PUT", path: "/projects/:id/roadmap/reorder", scope: "board:write", notes: "{status, ids}" },
      { method: "DELETE", path: "/projects/:id/roadmap/:rid", scope: "board:delete", notes: "unlinks feedback" },
      { method: "GET", path: "/projects/:id/changelog?include_drafts=true", scope: "board:read" },
      { method: "POST", path: "/projects/:id/changelog", scope: "board:write", notes: "{title, body (markdown), version?, publish?}" },
      { method: "PATCH", path: "/projects/:id/changelog/:cid", scope: "board:write", notes: "published: true|false" },
      { method: "DELETE", path: "/projects/:id/changelog/:cid", scope: "board:delete" },
    ],
  },
  {
    title: "docs.publicTitle",
    body: "docs.publicBody",
    endpoints: [
      { method: "GET", path: "/boards/:slug", scope: "—", notes: "roadmap (public items) + latest changelog" },
      { method: "GET", path: "/boards/:slug/changelog?page=", scope: "—" },
      { method: "POST", path: "/boards/:slug/items/:rid/vote", scope: "—", notes: "{voter_id} · idempotent" },
      { method: "DELETE", path: "/boards/:slug/items/:rid/vote", scope: "—", notes: "{voter_id}" },
      { method: "POST", path: "/boards/:slug/feedback", scope: "—", notes: "same body as ingest, type defaults to feature" },
    ],
  },
  {
    title: "docs.webhooksTitle",
    body: "docs.webhooksBody",
    endpoints: [
      { method: "GET", path: "/projects/:id/webhooks", scope: "projects:read" },
      { method: "POST", path: "/projects/:id/webhooks", scope: "projects:write", notes: "{url (https), events?, description?} → secret shown once · 402 webhooks" },
      { method: "PATCH", path: "/projects/:id/webhooks/:wid", scope: "projects:write", notes: "{url?, events?, description?, enabled?}" },
      { method: "POST", path: "/projects/:id/webhooks/:wid/test", scope: "projects:write", notes: "queues a ping" },
      { method: "GET", path: "/projects/:id/webhooks/:wid/deliveries?limit=", scope: "projects:read" },
      { method: "DELETE", path: "/projects/:id/webhooks/:wid", scope: "projects:delete" },
    ],
  },
  {
    title: "docs.duplicatesTitle",
    body: "docs.duplicatesBody",
    endpoints: [
      { method: "GET", path: "/projects/:id/feedback?duplicates=hide", scope: "feedback:read", notes: "hide merged items" },
      { method: "POST", path: "/projects/:id/feedback/:item/merge", scope: "feedback:write", notes: "{into} → item becomes a declined duplicate" },
      { method: "POST", path: "/projects/:id/feedback/:item/reply", scope: "feedback:write", notes: "{body} → emails the reporter · 400 no_reporter_email · 503 mail_disabled" },
      { method: "GET", path: "/projects/:id/views", scope: "feedback:read" },
      { method: "POST", path: "/projects/:id/views", scope: "feedback:write", notes: "{name, filters} · max 20" },
      { method: "PATCH", path: "/projects/:id/views/:vid", scope: "feedback:write" },
      { method: "DELETE", path: "/projects/:id/views/:vid", scope: "feedback:write" },
      { method: "GET", path: "/projects/:id/export?format=json|csv", scope: "feedback:read + board:read", notes: "retro.project.v1 or CSV; no screenshots" },
      { method: "GET", path: "/account/notifications", scope: "usage:read" },
      { method: "PATCH", path: "/account/notifications", scope: "projects:write", notes: "{email_new_feedback?, email_digest_minutes: 0|15|60|1440}" },
    ],
  },
];

const METHOD_CLASS: Record<string, string> = {
  GET: "bg-green-100 text-green-800",
  POST: "bg-primary-100 text-primary-800",
  PUT: "bg-amber-100 text-amber-800",
  PATCH: "bg-amber-100 text-amber-800",
  DELETE: "bg-red-100 text-red-800",
};

const EndpointTable = component$<{ endpoints: Endpoint[] }>(({ endpoints }) => {
  const i18n = useI18n();
  return (
    <div class="mt-4 overflow-x-auto rounded-xl border border-slate-200">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-2">{tr(i18n, "docs.colMethod")}</th>
            <th class="px-3 py-2">{tr(i18n, "docs.colPath")}</th>
            <th class="px-3 py-2">{tr(i18n, "docs.colScope")}</th>
            <th class="px-3 py-2">{tr(i18n, "docs.colNotes")}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {endpoints.map((e) => (
            <tr key={e.method + e.path}>
              <td class="px-3 py-2">
                <span class={["badge font-mono", METHOD_CLASS[e.method] ?? "bg-slate-100 text-slate-700"]}>{e.method}</span>
              </td>
              <td class="px-3 py-2 font-mono text-xs text-slate-800">{e.path}</td>
              <td class="px-3 py-2 font-mono text-xs text-slate-500">{e.scope}</td>
              <td class="px-3 py-2 text-xs text-slate-600">{e.notes ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

const Code = component$<{ code: string }>(({ code }) => (
  <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-3 text-xs leading-relaxed"><code>{code}</code></pre>
));

/**
 * Catch-all info section: /info/pricing, /info/docs and a generic placeholder
 * for any other slug (terms, privacy, …).
 */
export default component$(() => {
  const loc = useLocation();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const slug = (loc.params.slug || "").replace(/\/$/, "");

  if (slug === "pricing") {
    const early = features["early-access"];
    return (
      <div class="mx-auto max-w-6xl px-4 py-16">
        <div class="text-center">
          <h1 class="text-4xl font-bold text-slate-900">{early ? tr(i18n, "pricing.titlePlanned") : tr(i18n, "pricing.title")}</h1>
          <p class="mx-auto mt-3 max-w-2xl text-slate-600">{early ? tr(i18n, "pricing.introPlanned") : tr(i18n, "pricing.intro")}</p>
        </div>

        {early && (
          <div class="mx-auto mt-8 max-w-3xl rounded-xl border border-primary-200 bg-primary-50 p-6 text-center" data-testid="early-access-pricing">
            <p class="text-lg font-semibold text-primary-900">{tr(i18n, "pricing.earlyTitle")}</p>
            <p class="mt-2 text-sm text-primary-900/80">{tr(i18n, "pricing.earlyBody")}</p>
            <Link href="/blog/what-paid-plans-will-include" class="btn-primary mt-4">{tr(i18n, "pricing.earlyCta")}</Link>
          </div>
        )}

        <div class="mt-12">
          <PricingTable />
        </div>

        <div class="mt-10 card bg-primary-50 p-6 text-center">
          <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "pricing.enterpriseTitle")}</h2>
          <p class="mt-1 text-sm text-slate-600">{tr(i18n, "pricing.enterpriseBody")}</p>
          <a href="mailto:enrique@3m4.net?subject=retro%20Enterprise" class="btn-primary mt-4">{tr(i18n, "pricing.contactUs")}</a>
        </div>

        <p class="mt-8 text-center text-sm text-slate-500">
          {tr(i18n, "pricing.footnote")}
          {early && ` ${tr(i18n, "pricing.footnoteEarly")}`}
        </p>
      </div>
    );
  }

  if (slug === "docs") {
    return (
      <div class="mx-auto max-w-4xl px-4 py-16">
        <h1 class="text-3xl font-bold text-slate-900">{tr(i18n, "docs.title")}</h1>
        <p class="mt-2 text-slate-600">{tr(i18n, "docs.intro")}</p>
        <a href={CONTRACT_URL} target="_blank" rel="noreferrer" class="mt-3 inline-block text-sm font-medium text-primary-600 hover:underline">
          {tr(i18n, "docs.fullContract")} →
        </a>

        {/* Widget */}
        <section class="mt-8 card p-6" id="widget">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.widgetTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.widgetBody")}</p>
          <div class="mt-4 text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "docs.widgetScript")}</div>
          <Code code={WIDGET_SCRIPT} />
          <div class="mt-4 text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "docs.widgetElement")}</div>
          <Code code={WIDGET_ELEMENT} />
          <h3 class="mt-5 font-semibold text-slate-900">{tr(i18n, "docs.widgetAttrsTitle")}</h3>
          <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li><code>project-key</code> — {tr(i18n, "docs.attrProjectKey")}</li>
            <li><code>position</code> — <code>bottom-right</code> | <code>bottom-left</code></li>
            <li><code>lang</code> — {tr(i18n, "docs.attrLang")}</li>
            <li><code>theme</code> — {tr(i18n, "docs.attrTheme")}</li>
            <li><code>accent</code> — {tr(i18n, "docs.attrAccent")}</li>
            <li><code>hide-launcher</code> — {tr(i18n, "docs.attrHideLauncher")}</li>
          </ul>
          <h3 class="mt-5 font-semibold text-slate-900">{tr(i18n, "docs.widgetJsTitle")}</h3>
          <p class="mt-1 text-sm text-slate-600">{tr(i18n, "docs.widgetJsBody")}</p>
          <Code code={WIDGET_JS} />
          <p class="mt-3 text-sm text-slate-600">{tr(i18n, "docs.widgetScreenshot")}</p>
        </section>

        {/* Ingest */}
        <section class="mt-8 card p-6" id="ingest">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.ingestTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.ingestBody")}</p>
          <Code code={CURL_INGEST} />
          <ul class="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>{tr(i18n, "docs.ingestField1")}</li>
            <li>{tr(i18n, "docs.ingestField2")}</li>
            <li>{tr(i18n, "docs.ingestField3")}</li>
            <li>{tr(i18n, "docs.ingestField4")}</li>
            <li>{tr(i18n, "docs.ingestField5")}</li>
          </ul>
          <div class="mt-4 text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "docs.ingestForm")}</div>
          <Code code={FORM_SNIPPET} />
        </section>

        <div class="mt-8 card p-6">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.baseUrl")}</h2>
          <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-100 p-3 text-sm"><code>{APP_URL}/api</code></pre>
        </div>

        <section class="mt-8 card p-6">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.authTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.authBody")}</p>
          <ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            <li>{tr(i18n, "docs.authDashboard")}</li>
            <li>{tr(i18n, "docs.authApiKey")}</li>
            <li>{tr(i18n, "docs.authPublicKey")}</li>
          </ul>
        </section>

        {SECTIONS.map((s) => (
          <section key={s.title} class="mt-8 card p-6">
            <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, s.title)}</h2>
            <p class="mt-2 text-sm text-slate-600">{tr(i18n, s.body)}</p>
            <EndpointTable endpoints={s.endpoints} />
            {s.snippet && <Code code={s.snippet} />}
          </section>
        ))}

        {/* Webhook payload + signature */}
        <section class="mt-8 card p-6" id="webhooks">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.webhooksTitle")} · payload</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.webhooksEvents")}</p>
          <Code code={WEBHOOK_PAYLOAD} />
          <p class="mt-3 text-sm text-slate-600">{tr(i18n, "docs.webhooksHeaders")}</p>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.webhooksRetry")}</p>
          <h3 class="mt-5 font-semibold text-slate-900">{tr(i18n, "docs.webhooksVerify")}</h3>
          <div class="mt-2 text-xs uppercase tracking-wide text-slate-500">Node</div>
          <Code code={WEBHOOK_VERIFY_NODE} />
          <div class="mt-4 text-xs uppercase tracking-wide text-slate-500">Python</div>
          <Code code={WEBHOOK_VERIFY_PY} />
        </section>

        <section class="mt-8 card p-6" id="export">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.exportTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.exportBody")}</p>
          <Code code={`curl -H "X-API-Key: retro_live_…" "${APP_URL}/api/projects/$PROJECT/export?format=csv" -o feedback.csv`} />
        </section>

        <section class="mt-8 card p-6" id="turnstile">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.turnstileTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.turnstileBody")}</p>
        </section>

        <section class="mt-8 card p-6" id="notifications">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.notifyTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.notifyBody")}</p>
        </section>

        <section class="mt-8 card p-6">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.errorsTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.errorsBody")}</p>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.privacyBody")}</p>
        </section>

        <section class="mt-8 card p-6" id="mcp">
          <h2 class="text-xl font-semibold text-slate-900">{tr(i18n, "docs.mcpTitle")}</h2>
          <p class="mt-2 text-sm text-slate-600">{tr(i18n, "docs.mcpBody")}</p>
          <div class="mt-4 text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "docs.mcpLocal")}</div>
          <Code code={MCP_SNIPPET} />
          <div class="mt-4 text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "docs.mcpRemote")}</div>
          <Code code={MCP_REMOTE_SNIPPET} />
          <p class="mt-3 text-sm text-slate-600">{tr(i18n, "docs.mcpTools")}</p>
        </section>
      </div>
    );
  }

  // Generic placeholder for any other /info/* page.
  const title = slug ? slug.split("/")[0].replace(/-/g, " ") : tr(i18n, "info.title");
  return (
    <div class="mx-auto max-w-3xl px-4 py-20 text-center">
      <h1 class="text-3xl font-bold capitalize text-slate-900">{title}</h1>
      <p class="mt-3 text-slate-600">{tr(i18n, "info.comingSoon")}</p>
      <Link href="/info" class="btn-secondary mt-6">{tr(i18n, "info.backToInfo")}</Link>
    </div>
  );
});

export const head: DocumentHead = ({ params }) => {
  const slug = (params.slug || "info").split("/")[0];
  const title = slug === "pricing" ? "Pricing" : slug === "docs" ? "Docs" : slug.replace(/-/g, " ");
  return { title: `${title.charAt(0).toUpperCase() + title.slice(1)} — retro` };
};
