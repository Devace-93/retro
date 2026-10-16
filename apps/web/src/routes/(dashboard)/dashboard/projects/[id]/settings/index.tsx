import { component$, useContext, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { useLocation, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { FeaturesContext } from "../../../../../../lib/features";
import { TYPES, TYPE_LABEL } from "../../../../../../lib/feedback";
import { Switch } from "../../../../../../components/switch";
import { ProjectNav } from "../../../../../../components/project-nav";
import { tr, useI18n } from "../../../../../../i18n";
import { fmtDateTime } from "../../../../../../lib/feedback";
import type { FeedbackType, Project, ProjectPatch, Webhook, WebhookDelivery, WebhookEvent } from "../../../../../../lib/types";
import type { CatalogKey } from "../../../../../../i18n/catalog/en";
import planLimits from "../../../../../../../../../packages/shared/plan_limits.json";

const WEBHOOK_EVENTS: { ev: WebhookEvent; label: CatalogKey }[] = [
  { ev: "feedback.created", label: "psettings.eventCreated" },
  { ev: "feedback.status_changed", label: "psettings.eventStatus" },
  { ev: "roadmap.status_changed", label: "psettings.eventRoadmap" },
  { ev: "changelog.published", label: "psettings.eventChangelog" },
];
const EVENT_LABEL: Record<string, CatalogKey> = Object.fromEntries(WEBHOOK_EVENTS.map((e) => [e.ev, e.label]));
const MAX_WEBHOOKS = (planLimits.plans as Record<string, { webhooks_per_project?: number }>).pro?.webhooks_per_project ?? 5;
const DELIVERY_CLASS: Record<string, string> = {
  delivered: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

const APP_URL = (import.meta.env.VITE_APP_URL || "https://retro.3m4.net").replace(/\/$/, "");
const API_URL = /^https?:\/\//.test(import.meta.env.VITE_API_URL || "") ? (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") : `${APP_URL}/api`;

type SnippetKind = "script" | "element" | "curl" | "fetch";

function snippet(kind: SnippetKind, key: string): string {
  switch (kind) {
    case "script":
      return `<script src="${APP_URL}/widget.js" data-project-key="${key}" defer></script>`;
    case "element":
      return `<script src="${APP_URL}/widget.js" defer></script>
<retro-widget project-key="${key}" position="bottom-right" lang="auto" theme="auto"></retro-widget>`;
    case "curl":
      return `curl -X POST ${API_URL}/ingest/feedback \\
  -H "X-Project-Key: ${key}" -H "Content-Type: application/json" \\
  -d '{"type": "bug", "message": "The export button does nothing", "email": "me@example.com"}'`;
    case "fetch":
      return `await fetch("${API_URL}/ingest/feedback", {
  method: "POST",
  headers: { "X-Project-Key": "${key}", "Content-Type": "application/json" },
  body: JSON.stringify({ type: "feature", message: "Dark mode, please!", page_url: location.href }),
});`;
  }
}

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const features = useContext(FeaturesContext);
  const i18n = useI18n();
  const id = loc.params.id;

  const state = useStore<{
    project: Project | null;
    loading: boolean;
    error: string;
    saved: string;
    busy: string;
    copied: string;
    snippet: SnippetKind;
    rotateArmed: boolean;
    deleteText: string;
    // editable fields
    name: string;
    description: string;
    url: string;
    boardSlug: string;
    boardTitle: string;
    boardIntro: string;
    accent: string;
    turnstileSiteKey: string;
    turnstileSecret: string;
    exporting: string;
  }>({
    project: null,
    loading: true,
    error: "",
    saved: "",
    busy: "",
    copied: "",
    snippet: "script",
    rotateArmed: false,
    deleteText: "",
    name: "",
    description: "",
    url: "",
    boardSlug: "",
    boardTitle: "",
    boardIntro: "",
    accent: "",
    turnstileSiteKey: "",
    turnstileSecret: "",
    exporting: "",
  });

  const hooks = useStore<{
    items: Webhook[];
    loading: boolean;
    error: string;
    url: string;
    description: string;
    events: WebhookEvent[];
    creating: boolean;
    createdSecret: string;
    createdId: string;
    busy: string;
    openId: string;
    deliveries: WebhookDelivery[];
    deliveriesLoading: boolean;
    testSent: string;
  }>({
    items: [],
    loading: true,
    error: "",
    url: "",
    description: "",
    events: WEBHOOK_EVENTS.map((e) => e.ev),
    creating: false,
    createdSecret: "",
    createdId: "",
    busy: "",
    openId: "",
    deliveries: [],
    deliveriesLoading: false,
    testSent: "",
  });

  const apply = $((p: Project) => {
    state.project = p;
    state.name = p.name;
    state.description = p.description ?? "";
    state.url = p.url ?? "";
    state.boardSlug = p.board_slug;
    state.boardTitle = p.board_title ?? "";
    state.boardIntro = p.board_intro ?? "";
    state.accent = p.widget_accent ?? "";
    state.turnstileSiteKey = p.turnstile_site_key ?? "";
  });

  const loadHooks = $(async () => {
    hooks.loading = true;
    hooks.error = "";
    try {
      hooks.items = await api.listWebhooks(id);
    } catch (e) {
      hooks.error = errorMessage(i18n, e, "psettings.webhookLoadFailed");
    } finally {
      hooks.loading = false;
    }
  });

  const createHook = $(async () => {
    if (!hooks.url.trim()) return;
    hooks.creating = true;
    hooks.error = "";
    try {
      const w = await api.createWebhook(id, { url: hooks.url.trim(), events: hooks.events, description: hooks.description.trim() || undefined });
      hooks.createdSecret = w.secret ?? "";
      hooks.createdId = w.id;
      hooks.url = "";
      hooks.description = "";
      hooks.items = [...hooks.items, { ...w, secret: undefined }];
    } catch (e) {
      hooks.error = errorMessage(i18n, e, "psettings.webhookSaveFailed");
    } finally {
      hooks.creating = false;
    }
  });

  const toggleHook = $(async (w: Webhook, enabled: boolean) => {
    hooks.busy = w.id;
    try {
      const updated = await api.updateWebhook(id, w.id, { enabled });
      hooks.items = hooks.items.map((x) => (x.id === w.id ? updated : x));
    } catch (e) {
      hooks.error = errorMessage(i18n, e, "psettings.webhookSaveFailed");
    } finally {
      hooks.busy = "";
    }
  });

  const deleteHook = $(async (w: Webhook) => {
    if (!confirm(tr(i18n, "psettings.webhookDeleteConfirm"))) return;
    hooks.busy = w.id;
    try {
      await api.deleteWebhook(id, w.id);
      hooks.items = hooks.items.filter((x) => x.id !== w.id);
      if (hooks.openId === w.id) hooks.openId = "";
    } catch (e) {
      hooks.error = errorMessage(i18n, e, "psettings.webhookSaveFailed");
    } finally {
      hooks.busy = "";
    }
  });

  const loadDeliveries = $(async (w: Webhook) => {
    if (hooks.openId === w.id) {
      hooks.openId = "";
      return;
    }
    hooks.openId = w.id;
    hooks.deliveriesLoading = true;
    try {
      hooks.deliveries = await api.webhookDeliveries(id, w.id);
    } catch {
      hooks.deliveries = [];
    } finally {
      hooks.deliveriesLoading = false;
    }
  });

  const testHook = $(async (w: Webhook) => {
    hooks.busy = w.id;
    hooks.testSent = "";
    try {
      await api.testWebhook(id, w.id);
      hooks.testSent = w.id;
      setTimeout(() => (hooks.testSent = ""), 2500);
      if (hooks.openId === w.id) hooks.deliveries = await api.webhookDeliveries(id, w.id);
    } catch (e) {
      hooks.error = errorMessage(i18n, e, "psettings.webhookSaveFailed");
    } finally {
      hooks.busy = "";
    }
  });

  const saveTurnstile = $(async () => {
    const patch: ProjectPatch = { turnstile_site_key: state.turnstileSiteKey.trim() || null };
    if (state.turnstileSecret.trim()) patch.turnstile_secret = state.turnstileSecret.trim();
    await save(patch, "turnstile");
    state.turnstileSecret = "";
  });

  const clearTurnstile = $(async () => {
    await save({ turnstile_site_key: null, turnstile_secret: null }, "turnstile");
    state.turnstileSecret = "";
  });

  const exportProject = $(async (format: "json" | "csv") => {
    if (!state.project) return;
    state.exporting = format;
    state.error = "";
    try {
      await api.exportProject(id, format, `${state.project.key}-${format === "json" ? "export.json" : "feedback.csv"}`);
    } catch (e) {
      state.error = errorMessage(i18n, e, "psettings.exportFailed");
    } finally {
      state.exporting = "";
    }
  });

  const load = $(async () => {
    state.loading = true;
    state.error = "";
    try {
      await apply(await api.getProject(id));
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.error = errorMessage(i18n, e, "psettings.loadFailed");
    } finally {
      state.loading = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    load();
    loadHooks();
  });

  const save = $(async (patch: ProjectPatch, busy: string) => {
    state.busy = busy;
    state.error = "";
    state.saved = "";
    try {
      await apply(await api.updateProject(id, patch));
      state.saved = busy;
      setTimeout(() => (state.saved = ""), 1500);
    } catch (e) {
      state.error = errorMessage(i18n, e, "psettings.saveFailed");
    } finally {
      state.busy = "";
    }
  });

  const copy = $(async (text: string, which: string) => {
    try {
      await navigator.clipboard.writeText(text);
      state.copied = which;
      setTimeout(() => (state.copied = ""), 1500);
    } catch {
      /* clipboard unavailable */
    }
  });

  const rotate = $(async () => {
    if (!state.rotateArmed) {
      state.rotateArmed = true;
      return;
    }
    state.busy = "rotate";
    state.rotateArmed = false;
    try {
      const res = await api.rotateProjectKey(id);
      if (state.project) state.project = { ...state.project, public_key: res.public_key, public_key_prefix: res.public_key_prefix };
    } catch (e) {
      state.error = errorMessage(i18n, e, "psettings.rotateFailed");
    } finally {
      state.busy = "";
    }
  });

  const toggleType = $(async (t: FeedbackType, on: boolean) => {
    if (!state.project) return;
    const next = on ? [...new Set([...state.project.types_enabled, t])] : state.project.types_enabled.filter((x) => x !== t);
    if (next.length === 0) return;
    await save({ types_enabled: TYPES.filter((x) => next.includes(x)) }, "types");
  });

  const remove = $(async () => {
    if (!state.project || state.deleteText !== state.project.key) return;
    state.busy = "delete";
    try {
      await api.deleteProject(id);
      await nav("/dashboard");
    } catch (e) {
      state.error = errorMessage(i18n, e, "psettings.deleteProjectFailed");
      state.busy = "";
    }
  });

  const p = state.project;
  const key = p?.public_key ?? "retro_pub_…";
  const kinds: { kind: SnippetKind; label: string }[] = [
    { kind: "script", label: tr(i18n, "psettings.snippetScript") },
    { kind: "element", label: tr(i18n, "psettings.snippetElement") },
    { kind: "curl", label: "curl" },
    { kind: "fetch", label: "fetch" },
  ];

  return (
    <>
      <ProjectNav project={p} id={id} />
      <div class="mx-auto max-w-4xl space-y-8 px-4 py-6">
        {state.error && <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
        {state.loading && <div class="card p-10 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>}

        {p && (
          <>
            {/* Install */}
            <section class="card p-6" id="install">
              <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.installTitle")}</h2>
              <p class="mt-1 text-sm text-slate-600">{tr(i18n, "psettings.installBody")}</p>
              <div class="mt-4">
                <div class="label">{tr(i18n, "psettings.publicKey")}</div>
                <div class="flex flex-wrap items-center gap-2">
                  <code class="flex-1 overflow-x-auto rounded bg-slate-100 px-3 py-2 text-sm text-slate-800" data-testid="public-key">{key}</code>
                  <button type="button" class="btn-secondary" onClick$={() => copy(key, "key")}>
                    {state.copied === "key" ? tr(i18n, "common.copied") : tr(i18n, "common.copy")}
                  </button>
                  <button type="button" class={state.rotateArmed ? "btn bg-amber-500 text-white hover:bg-amber-600" : "btn-ghost"} disabled={state.busy === "rotate"} onClick$={rotate}>
                    {state.rotateArmed ? tr(i18n, "psettings.rotateConfirm") : tr(i18n, "psettings.rotate")}
                  </button>
                  {state.rotateArmed && <button type="button" class="btn-ghost" onClick$={() => (state.rotateArmed = false)}>{tr(i18n, "common.cancel")}</button>}
                </div>
                <p class="mt-1 text-xs text-slate-500">{tr(i18n, "psettings.publicKeyHint")}</p>
              </div>
              <div class="mt-5 flex flex-wrap gap-1">
                {kinds.map((k) => (
                  <button key={k.kind} type="button" class={["rounded-lg px-3 py-1.5 text-sm font-medium", state.snippet === k.kind ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-slate-100"]} onClick$={() => (state.snippet = k.kind)}>
                    {k.label}
                  </button>
                ))}
              </div>
              <div class="relative mt-2">
                <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-3 text-xs leading-relaxed"><code>{snippet(state.snippet, key)}</code></pre>
                <button type="button" class="btn-secondary absolute right-2 top-2 px-2 py-1 text-xs" onClick$={() => copy(snippet(state.snippet, key), "snippet")}>
                  {state.copied === "snippet" ? tr(i18n, "common.copied") : tr(i18n, "common.copy")}
                </button>
              </div>
              <p class="mt-2 text-xs text-slate-500">
                {tr(i18n, "psettings.moreDocs")}{" "}
                <a href="/info/docs" class="text-primary-600 hover:underline">/info/docs</a>
              </p>
            </section>

            {/* Widget options */}
            <section class="card p-6">
              <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.widgetTitle")}</h2>
              <p class="mt-1 text-sm text-slate-600">{tr(i18n, "psettings.widgetBody")}</p>
              <div class="mt-4">
                <div class="label">{tr(i18n, "psettings.typesEnabled")}</div>
                <div class="flex flex-wrap gap-4">
                  {TYPES.map((t) => (
                    <label key={t} class="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={p.types_enabled.includes(t)} disabled={!!state.busy || (p.types_enabled.includes(t) && p.types_enabled.length === 1)} onChange$={(_, el) => toggleType(t, el.checked)} />
                      {tr(i18n, TYPE_LABEL[t])}
                    </label>
                  ))}
                </div>
              </div>
              <div class="mt-4 grid gap-3 sm:grid-cols-2">
                <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                  <span>
                    <span class="font-medium text-slate-800">{tr(i18n, "psettings.allowScreenshots")}</span>
                    {!features.screenshots && <span class="ml-2 badge bg-amber-100 text-amber-800">{tr(i18n, "psettings.featureOff")}</span>}
                  </span>
                  <Switch checked={p.allow_screenshots} label={tr(i18n, "psettings.allowScreenshots")} disabled={!!state.busy} onToggle$={(next) => save({ allow_screenshots: next }, "screens")} />
                </label>
                <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                  <span class="font-medium text-slate-800">{tr(i18n, "psettings.allowEmail")}</span>
                  <Switch checked={p.allow_email} label={tr(i18n, "psettings.allowEmail")} disabled={!!state.busy} onToggle$={(next) => save({ allow_email: next }, "email")} />
                </label>
              </div>
              <div class="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <label class="label" for="accent">{tr(i18n, "psettings.accent")}</label>
                  <div class="flex items-center gap-2">
                    <input type="color" aria-label={tr(i18n, "psettings.accent")} value={state.accent || "#059669"} onInput$={(_, el) => (state.accent = el.value)} class="h-9 w-12 cursor-pointer rounded border border-slate-300" />
                    <input id="accent" type="text" class="input w-32 font-mono" placeholder="#059669" value={state.accent} onInput$={(_, el) => (state.accent = el.value)} />
                  </div>
                </div>
                <button type="button" class="btn-secondary" disabled={!!state.busy} onClick$={() => save({ widget_accent: state.accent.trim() || null }, "accent")}>
                  {state.saved === "accent" ? tr(i18n, "common.saved") : tr(i18n, "common.save")}
                </button>
                {state.accent && <button type="button" class="btn-ghost" onClick$={() => { state.accent = ""; save({ widget_accent: null }, "accent"); }}>{tr(i18n, "psettings.accentReset")}</button>}
              </div>
            </section>

            {/* Board */}
            <section class="card p-6" id="board">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.boardTitle")}</h2>
                  <p class="mt-1 text-sm text-slate-600">{tr(i18n, "psettings.boardBody")}</p>
                </div>
                <label class="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {p.board_enabled ? tr(i18n, "common.on") : tr(i18n, "common.off")}
                  <Switch checked={p.board_enabled} label={tr(i18n, "psettings.boardEnabled")} disabled={!!state.busy || !features["public-boards"]} onToggle$={(next) => save({ board_enabled: next }, "board")} />
                </label>
              </div>
              {!features["public-boards"] && <p class="mt-2 text-xs text-amber-700">{tr(i18n, "psettings.boardsFeatureOff")}</p>}
              {p.board_enabled && p.board_url && (
                <p class="mt-3 text-sm">
                  <a href={p.board_url} target="_blank" rel="noreferrer" class="text-primary-600 hover:underline">{p.board_url}</a>
                </p>
              )}
              <form class="mt-4 space-y-4" preventdefault:submit onSubmit$={() => save({ board_slug: state.boardSlug.trim(), board_title: state.boardTitle.trim() || null, board_intro: state.boardIntro.trim() || null }, "boardform")}>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label class="label" for="bslug">{tr(i18n, "psettings.boardSlug")}</label>
                    <div class="flex items-center">
                      <span class="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-2 py-2 text-xs text-slate-500">{APP_URL.replace(/^https?:\/\//, "")}/b/</span>
                      <input id="bslug" type="text" class="input rounded-l-none font-mono" pattern="[a-z0-9][a-z0-9-]{1,62}" value={state.boardSlug} onInput$={(_, el) => (state.boardSlug = el.value)} />
                    </div>
                  </div>
                  <div>
                    <label class="label" for="btitle">{tr(i18n, "psettings.boardTitleField")} <span class="text-slate-400">{tr(i18n, "common.optional")}</span></label>
                    <input id="btitle" type="text" class="input" placeholder={p.name} value={state.boardTitle} onInput$={(_, el) => (state.boardTitle = el.value)} />
                  </div>
                </div>
                <div>
                  <label class="label" for="bintro">{tr(i18n, "psettings.boardIntro")} <span class="text-slate-400">{tr(i18n, "common.markdown")}</span></label>
                  <textarea id="bintro" class="input" rows={3} value={state.boardIntro} onInput$={(_, el) => (state.boardIntro = el.value)} />
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                    <span class="font-medium text-slate-800">{tr(i18n, "psettings.allowVotes")}</span>
                    <Switch checked={p.allow_votes} label={tr(i18n, "psettings.allowVotes")} disabled={!!state.busy} onToggle$={(next) => save({ allow_votes: next }, "votes")} />
                  </label>
                  <label class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                    <span class="font-medium text-slate-800">{tr(i18n, "psettings.allowSubmissions")}</span>
                    <Switch checked={p.allow_board_submissions} label={tr(i18n, "psettings.allowSubmissions")} disabled={!!state.busy} onToggle$={(next) => save({ allow_board_submissions: next }, "subs")} />
                  </label>
                </div>
                <div class="flex justify-end">
                  <button type="submit" class="btn-primary" disabled={!!state.busy}>
                    {state.busy === "boardform" ? tr(i18n, "common.saving") : state.saved === "boardform" ? tr(i18n, "common.saved") : tr(i18n, "common.save")}
                  </button>
                </div>
              </form>
            </section>

            {/* Webhooks */}
            <section class="card p-6" id="webhooks" data-testid="webhooks">
              <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.webhooksTitle")}</h2>
              <p class="mt-1 text-sm text-slate-600">{tr(i18n, "psettings.webhooksBody", { max: MAX_WEBHOOKS })}</p>
              {!features.webhooks && <p class="mt-2 text-xs text-amber-700">{tr(i18n, "psettings.webhooksFeatureOff")}</p>}
              {hooks.error && <div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{hooks.error}</div>}

              {hooks.createdSecret && (
                <div class="mt-4 rounded-lg border border-green-300 bg-green-50 p-4">
                  <p class="text-sm font-semibold text-green-800">{tr(i18n, "psettings.webhookSecretOnce")}</p>
                  <div class="mt-2 flex items-center gap-2">
                    <code class="flex-1 overflow-x-auto rounded bg-white px-3 py-2 text-sm text-slate-800" data-testid="webhook-secret">{hooks.createdSecret}</code>
                    <button type="button" class="btn-secondary" onClick$={() => copy(hooks.createdSecret, "whsecret")}>
                      {state.copied === "whsecret" ? tr(i18n, "common.copied") : tr(i18n, "common.copy")}
                    </button>
                  </div>
                  <button type="button" class="btn-ghost mt-2 text-xs" onClick$={() => (hooks.createdSecret = "")}>{tr(i18n, "common.dismiss")}</button>
                </div>
              )}

              <div class="mt-4 overflow-hidden rounded-lg border border-slate-200">
                {hooks.loading ? (
                  <div class="p-6 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>
                ) : hooks.items.length === 0 ? (
                  <div class="p-6 text-center text-sm text-slate-500">{tr(i18n, "psettings.webhookEmpty")}</div>
                ) : (
                  <ul class="divide-y divide-slate-100">
                    {hooks.items.map((w) => (
                      <li key={w.id} class="p-4 text-sm">
                        <div class="flex flex-wrap items-center gap-3">
                          <Switch small checked={w.enabled} label={tr(i18n, "common.enabled")} disabled={hooks.busy === w.id} onToggle$={(next) => toggleHook(w, next)} />
                          <div class="min-w-0 flex-1">
                            <div class="truncate font-mono text-xs text-slate-800">{w.url}</div>
                            <div class="mt-0.5 flex flex-wrap gap-1 text-xs text-slate-500">
                              {w.description && <span class="mr-1">{w.description} ·</span>}
                              {w.events.map((ev) => <span key={ev} class="badge bg-slate-100 text-slate-600">{EVENT_LABEL[ev] ? tr(i18n, EVENT_LABEL[ev]) : ev}</span>)}
                            </div>
                            <div class="mt-0.5 text-xs text-slate-400">
                              {tr(i18n, "psettings.webhookLastDelivery")}: {w.last_delivery_at ? `${fmtDateTime(w.last_delivery_at, i18n.lang)} · ${w.last_status ?? ""}` : tr(i18n, "psettings.webhookNever")} · <span class="font-mono">{w.secret_prefix}…</span>
                            </div>
                          </div>
                          <div class="flex gap-1">
                            <button type="button" class="btn-ghost text-xs" disabled={hooks.busy === w.id} onClick$={() => testHook(w)}>
                              {hooks.testSent === w.id ? tr(i18n, "psettings.webhookTestSent") : tr(i18n, "psettings.webhookTest")}
                            </button>
                            <button type="button" class="btn-ghost text-xs" aria-expanded={hooks.openId === w.id} onClick$={() => loadDeliveries(w)}>{tr(i18n, "psettings.webhookDeliveries")}</button>
                            <button type="button" class="btn-ghost text-xs text-red-600" disabled={hooks.busy === w.id} onClick$={() => deleteHook(w)}>{tr(i18n, "common.delete")}</button>
                          </div>
                        </div>
                        {hooks.openId === w.id && (
                          <div class="mt-3 rounded-lg bg-slate-50 p-3">
                            {hooks.deliveriesLoading ? (
                              <div class="text-xs text-slate-400">{tr(i18n, "common.loading")}</div>
                            ) : hooks.deliveries.length === 0 ? (
                              <div class="text-xs text-slate-500">{tr(i18n, "psettings.webhookNoDeliveries")}</div>
                            ) : (
                              <ul class="space-y-1 text-xs">
                                {hooks.deliveries.map((d) => (
                                  <li key={d.id} class="flex flex-wrap items-center gap-2">
                                    <span class={["badge", DELIVERY_CLASS[d.status] ?? "bg-slate-100 text-slate-700"]}>
                                      {d.status === "delivered" ? tr(i18n, "psettings.deliveryDelivered") : d.status === "pending" ? tr(i18n, "psettings.deliveryPending") : tr(i18n, "psettings.deliveryFailed")}
                                    </span>
                                    <span class="font-mono text-slate-700">{d.event}</span>
                                    <span class="text-slate-500">{fmtDateTime(d.created_at, i18n.lang)}</span>
                                    <span class="text-slate-400">{tr(i18n, "psettings.webhookAttempts", { n: d.attempts })}{d.response_code ? ` · HTTP ${d.response_code}` : ""}</span>
                                    {d.last_error && <span class="truncate text-red-600" title={d.last_error}>{d.last_error}</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <form class="mt-4 space-y-3" preventdefault:submit onSubmit$={createHook}>
                <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <label class="label" for="whurl">{tr(i18n, "psettings.webhookUrl")}</label>
                    <input id="whurl" type="url" class="input font-mono" placeholder="https://example.com/hooks/retro" value={hooks.url} onInput$={(_, el) => (hooks.url = el.value)} />
                  </div>
                  <div>
                    <label class="label" for="whdesc">{tr(i18n, "psettings.webhookDescription")} <span class="text-slate-400">{tr(i18n, "common.optional")}</span></label>
                    <input id="whdesc" type="text" class="input" value={hooks.description} onInput$={(_, el) => (hooks.description = el.value)} />
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-4">
                  <span class="label mb-0">{tr(i18n, "common.events")}</span>
                  {WEBHOOK_EVENTS.map((e) => (
                    <label key={e.ev} class="flex items-center gap-1.5 text-sm text-slate-700">
                      <input type="checkbox" checked={hooks.events.includes(e.ev)} onChange$={(_, el) => { hooks.events = el.checked ? [...new Set([...hooks.events, e.ev])] : hooks.events.filter((x) => x !== e.ev); }} />
                      {tr(i18n, e.label)}
                    </label>
                  ))}
                  <button type="submit" class="btn-primary ml-auto" disabled={hooks.creating || !hooks.url.trim() || hooks.events.length === 0 || !features.webhooks}>
                    {hooks.creating ? tr(i18n, "common.creating") : tr(i18n, "psettings.webhookAdd")}
                  </button>
                </div>
              </form>
            </section>

            {/* Spam protection */}
            <section class="card p-6" id="spam" data-testid="spam-protection">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.spamTitle")}</h2>
                  <p class="mt-1 text-sm text-slate-600">{tr(i18n, "psettings.spamBody")}</p>
                </div>
                <span class={["badge", p.turnstile_enabled ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"]} data-testid="turnstile-status">
                  {p.turnstile_enabled ? tr(i18n, "psettings.turnstileOn") : tr(i18n, "psettings.turnstileOff")}
                </span>
              </div>
              <form class="mt-4 space-y-3" preventdefault:submit onSubmit$={saveTurnstile}>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="label" for="tssite">{tr(i18n, "psettings.turnstileSiteKey")}</label>
                    <input id="tssite" type="text" class="input font-mono" autoComplete="off" value={state.turnstileSiteKey} onInput$={(_, el) => (state.turnstileSiteKey = el.value)} />
                  </div>
                  <div>
                    <label class="label" for="tssecret">{tr(i18n, "psettings.turnstileSecret")}</label>
                    <input id="tssecret" type="password" class="input font-mono" autoComplete="new-password" placeholder={p.turnstile_enabled ? "••••••••" : ""} value={state.turnstileSecret} onInput$={(_, el) => (state.turnstileSecret = el.value)} />
                    <p class="mt-1 text-xs text-slate-500">{tr(i18n, "psettings.turnstileSecretHint")}</p>
                  </div>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-xs text-slate-500">{tr(i18n, "psettings.turnstileDocs")}</span>
                  <div class="flex gap-2">
                    {p.turnstile_enabled && <button type="button" class="btn-ghost text-red-600" disabled={!!state.busy} onClick$={clearTurnstile}>{tr(i18n, "psettings.turnstileClear")}</button>}
                    <button type="submit" class="btn-primary" disabled={!!state.busy || !state.turnstileSiteKey.trim() || (!state.turnstileSecret.trim() && !p.turnstile_enabled)}>
                      {state.busy === "turnstile" ? tr(i18n, "common.saving") : state.saved === "turnstile" ? tr(i18n, "common.saved") : tr(i18n, "common.save")}
                    </button>
                  </div>
                </div>
              </form>
            </section>

            {/* Export */}
            <section class="card p-6" id="export" data-testid="export">
              <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.exportTitle")}</h2>
              <p class="mt-1 text-sm text-slate-600">{tr(i18n, "psettings.exportBody")}</p>
              <div class="mt-4 flex flex-wrap gap-2">
                <button type="button" class="btn-secondary" disabled={!!state.exporting} onClick$={() => exportProject("json")}>
                  {state.exporting === "json" ? tr(i18n, "common.loading") : tr(i18n, "psettings.exportJson")}
                </button>
                <button type="button" class="btn-secondary" disabled={!!state.exporting} onClick$={() => exportProject("csv")}>
                  {state.exporting === "csv" ? tr(i18n, "common.loading") : tr(i18n, "psettings.exportCsv")}
                </button>
              </div>
            </section>

            {/* Project info */}
            <section class="card p-6">
              <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "psettings.infoTitle")}</h2>
              <form class="mt-4 space-y-4" preventdefault:submit onSubmit$={() => save({ name: state.name.trim(), description: state.description.trim() || null, url: state.url.trim() || null }, "info")}>
                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label class="label" for="pname">{tr(i18n, "common.name")}</label>
                    <input id="pname" type="text" required class="input" value={state.name} onInput$={(_, el) => (state.name = el.value)} />
                  </div>
                  <div>
                    <label class="label" for="purl">{tr(i18n, "dash.projectUrl")}</label>
                    <input id="purl" type="url" class="input" value={state.url} onInput$={(_, el) => (state.url = el.value)} />
                  </div>
                </div>
                <div>
                  <label class="label" for="pdesc">{tr(i18n, "common.description")}</label>
                  <textarea id="pdesc" class="input" rows={2} value={state.description} onInput$={(_, el) => (state.description = el.value)} />
                </div>
                <div class="flex items-center justify-between">
                  <span class="font-mono text-xs text-slate-400">{tr(i18n, "common.key")}: {p.key}</span>
                  <button type="submit" class="btn-primary" disabled={!!state.busy}>
                    {state.busy === "info" ? tr(i18n, "common.saving") : state.saved === "info" ? tr(i18n, "common.saved") : tr(i18n, "common.save")}
                  </button>
                </div>
              </form>
            </section>

            {/* Danger zone */}
            <section class="card border-red-200 p-6">
              <h2 class="text-lg font-semibold text-red-700">{tr(i18n, "psettings.dangerTitle")}</h2>
              <p class="mt-1 text-sm text-slate-600">{tr(i18n, "psettings.dangerBody")}</p>
              <form class="mt-4 flex flex-wrap items-end gap-3" preventdefault:submit onSubmit$={remove}>
                <div class="flex-1">
                  <label class="label" for="delkey">{tr(i18n, "psettings.deleteProjectConfirm")}</label>
                  <input id="delkey" type="text" class="input font-mono" placeholder={p.key} value={state.deleteText} onInput$={(_, el) => (state.deleteText = el.value)} autoComplete="off" />
                </div>
                <button type="submit" class="btn bg-red-600 text-white hover:bg-red-700" disabled={state.deleteText !== p.key || state.busy === "delete"}>
                  {state.busy === "delete" ? tr(i18n, "common.deleting") : tr(i18n, "psettings.deleteProject")}
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </>
  );
});

export const head: DocumentHead = { title: "Project settings — retro" };
