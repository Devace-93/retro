import { component$, useContext, useStore, useVisibleTask$, useTask$, $ } from "@builder.io/qwik";
import { Link, useLocation, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { FeaturesContext } from "../../../../../lib/features";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  SENTIMENTS,
  SENTIMENT_LABEL,
  STATUSES,
  STATUS_LABEL,
  TYPES,
  TYPE_LABEL,
  fmtBytes,
  fmtDateTime,
  parseTags,
  shortUrl,
} from "../../../../../lib/feedback";
import { PriorityBadge, SentimentBadge, StatusBadge, TypeBadge } from "../../../../../components/badges";
import { ProjectNav } from "../../../../../components/project-nav";
import { tr, useI18n } from "../../../../../i18n";
import type { FeedbackItem, FeedbackStatus, Priority, Project, SavedView, SavedViewFilters, Summary } from "../../../../../lib/types";
import type { CatalogKey } from "../../../../../i18n/catalog/en";

/** Virtual views rendered before the saved ones; never stored. */
const VIRTUAL_VIEWS: { id: string; label: CatalogKey; filters: SavedViewFilters }[] = [
  { id: "all", label: "inbox.viewAll", filters: {} },
  { id: "new", label: "inbox.viewNew", filters: { status: "new" } },
  { id: "bugs", label: "inbox.viewBugs", filters: { type: "bug" } },
  { id: "features", label: "inbox.viewFeatures", filters: { type: "feature" } },
  { id: "positive", label: "inbox.viewPositive", filters: { sentiment: "positive" } },
  { id: "negative", label: "inbox.viewNegative", filters: { sentiment: "negative" } },
];

function sameFilters(a: SavedViewFilters, b: SavedViewFilters): boolean {
  const norm = (f: SavedViewFilters) =>
    JSON.stringify({ q: f.q || "", type: f.type || "", status: f.status || "", sentiment: f.sentiment || "", priority: f.priority || "", tag: f.tag || "", has_screenshot: !!f.has_screenshot, sort: f.sort || "newest" });
  return norm(a) === norm(b);
}

const PER_PAGE = 50;

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const i18n = useI18n();
  const features = useContext(FeaturesContext);
  const id = loc.params.id;

  const state = useStore<{
    project: Project | null;
    summary: Summary | null;
    tags: { tag: string; count: number }[];
    items: FeedbackItem[];
    total: number;
    page: number;
    loading: boolean;
    loadError: string;
    // filters
    q: string;
    type: string;
    status: string;
    sentiment: string;
    priority: string;
    tag: string;
    hasScreenshot: boolean;
    sort: "newest" | "oldest";
    hideDuplicates: boolean;
    views: SavedView[];
    viewNameOpen: boolean;
    viewName: string;
    viewBusy: boolean;
    viewError: string;
  }>({
    project: null,
    summary: null,
    tags: [],
    items: [],
    total: 0,
    page: 1,
    loading: true,
    loadError: "",
    q: "",
    type: "",
    status: "",
    sentiment: "",
    priority: "",
    tag: "",
    hasScreenshot: false,
    sort: "newest",
    hideDuplicates: false,
    views: [],
    viewNameOpen: false,
    viewName: "",
    viewBusy: false,
    viewError: "",
  });

  const drawer = useStore<{
    open: boolean;
    item: FeedbackItem | null;
    loading: boolean;
    error: string;
    screenshotUrl: string;
    tagsText: string;
    note: string;
    busy: string;
    deleteArmed: boolean;
    reply: string;
    replyError: string;
    mergeArmed: string;
    dupTarget: FeedbackItem | null;
  }>({ open: false, item: null, loading: false, error: "", screenshotUrl: "", tagsText: "", note: "", busy: "", deleteArmed: false, reply: "", replyError: "", mergeArmed: "", dupTarget: null });

  const loadProject = $(async () => {
    try {
      const [project, summary, tags, views] = await Promise.all([
        api.getProject(id),
        api.projectSummary(id).catch(() => null),
        api.projectTags(id).catch(() => ({ tags: [] })),
        api.listViews(id).catch(() => [] as SavedView[]),
      ]);
      state.project = project;
      state.summary = summary;
      state.tags = tags.tags;
      state.views = views;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.loadError = errorMessage(i18n, e, "inbox.loadFailed");
    }
  });

  const loadItems = $(async () => {
    state.loading = true;
    state.loadError = "";
    try {
      const res = await api.listFeedback(id, {
        q: state.q.trim() || undefined,
        type: state.type || undefined,
        status: state.status || undefined,
        sentiment: state.sentiment || undefined,
        priority: state.priority || undefined,
        tag: state.tag || undefined,
        has_screenshot: state.hasScreenshot || undefined,
        page: state.page,
        per_page: PER_PAGE,
        sort: state.sort,
        duplicates: state.hideDuplicates ? "hide" : undefined,
      });
      state.items = res.items;
      state.total = res.total;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.loadError = errorMessage(i18n, e, "inbox.loadFailed");
    } finally {
      state.loading = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    loadProject();
    loadItems();
  });

  // Reload the list whenever a filter changes (debounce the search box).
  useTask$(({ track, cleanup }) => {
    track(() => [state.q, state.type, state.status, state.sentiment, state.priority, state.tag, state.hasScreenshot, state.sort, state.page, state.hideDuplicates]);
    if (typeof window === "undefined") return;
    const t = setTimeout(() => loadItems(), state.q ? 300 : 0);
    cleanup(() => clearTimeout(t));
  });

  const refreshCounts = $(async () => {
    try {
      const [project, summary] = await Promise.all([api.getProject(id), api.projectSummary(id)]);
      state.project = project;
      state.summary = summary;
    } catch {
      /* counts are decorative */
    }
  });

  const currentFilters = $((): SavedViewFilters => ({
    q: state.q.trim() || undefined,
    type: state.type || undefined,
    status: state.status || undefined,
    sentiment: state.sentiment || undefined,
    priority: state.priority || undefined,
    tag: state.tag || undefined,
    has_screenshot: state.hasScreenshot || undefined,
    sort: state.sort,
  }));

  const applyView = $((f: SavedViewFilters) => {
    state.q = f.q ?? "";
    state.type = f.type ?? "";
    state.status = f.status ?? "";
    state.sentiment = f.sentiment ?? "";
    state.priority = f.priority ?? "";
    state.tag = f.tag ?? "";
    state.hasScreenshot = !!f.has_screenshot;
    state.sort = f.sort === "oldest" ? "oldest" : "newest";
    state.page = 1;
  });

  const saveView = $(async () => {
    const name = state.viewName.trim();
    if (!name) return;
    state.viewBusy = true;
    state.viewError = "";
    try {
      const view = await api.createView(id, name, await currentFilters());
      state.views = [...state.views, view];
      state.viewName = "";
      state.viewNameOpen = false;
    } catch (e) {
      state.viewError = errorMessage(i18n, e, "inbox.viewsFailed");
    } finally {
      state.viewBusy = false;
    }
  });

  const deleteView = $(async (v: SavedView) => {
    if (!confirm(tr(i18n, "inbox.deleteViewConfirm"))) return;
    try {
      await api.deleteView(id, v.id);
      state.views = state.views.filter((x) => x.id !== v.id);
    } catch (e) {
      state.viewError = errorMessage(i18n, e, "inbox.viewsFailed");
    }
  });

  const closeDrawer = $(() => {
    drawer.open = false;
    drawer.item = null;
    drawer.error = "";
    drawer.deleteArmed = false;
    drawer.mergeArmed = "";
    drawer.reply = "";
    drawer.replyError = "";
    drawer.dupTarget = null;
    if (drawer.screenshotUrl) {
      URL.revokeObjectURL(drawer.screenshotUrl);
      drawer.screenshotUrl = "";
    }
  });

  const openItem = $(async (item: FeedbackItem) => {
    if (drawer.screenshotUrl) URL.revokeObjectURL(drawer.screenshotUrl);
    drawer.screenshotUrl = "";
    drawer.open = true;
    drawer.loading = true;
    drawer.error = "";
    drawer.deleteArmed = false;
    drawer.item = item;
    drawer.tagsText = item.tags.join(", ");
    drawer.note = "";
    drawer.reply = "";
    drawer.replyError = "";
    drawer.mergeArmed = "";
    drawer.dupTarget = null;
    try {
      const full = await api.getFeedback(id, item.id);
      drawer.item = full;
      drawer.tagsText = full.tags.join(", ");
      if (full.has_screenshot) {
        api.screenshotUrl(id, full.id).then((url) => (drawer.screenshotUrl = url)).catch(() => {});
      }
      if (full.duplicate_of) {
        api.getFeedback(id, full.duplicate_of).then((t) => (drawer.dupTarget = t)).catch(() => {});
      }
    } catch (e) {
      drawer.error = errorMessage(i18n, e, "inbox.loadFailed");
    } finally {
      drawer.loading = false;
    }
  });

  /** Apply a PATCH and sync the row in the list. */
  const patch = $(async (fields: Parameters<typeof api.updateFeedback>[2], busy: string) => {
    if (!drawer.item) return;
    drawer.busy = busy;
    drawer.error = "";
    try {
      const updated = await api.updateFeedback(id, drawer.item.id, fields);
      drawer.item = { ...updated, notes: updated.notes ?? drawer.item.notes };
      state.items = state.items.map((it) => (it.id === updated.id ? { ...it, ...updated, notes: undefined } : it));
      refreshCounts();
    } catch (e) {
      drawer.error = errorMessage(i18n, e, "inbox.updateFailed");
    } finally {
      drawer.busy = "";
    }
  });

  const addNote = $(async () => {
    if (!drawer.item || !drawer.note.trim()) return;
    drawer.busy = "note";
    try {
      const note = await api.addNote(id, drawer.item.id, drawer.note.trim());
      drawer.item = { ...drawer.item, notes: [...(drawer.item.notes ?? []), note] };
      drawer.note = "";
    } catch (e) {
      drawer.error = errorMessage(i18n, e, "inbox.updateFailed");
    } finally {
      drawer.busy = "";
    }
  });

  const deleteNote = $(async (noteId: string) => {
    if (!drawer.item) return;
    try {
      await api.deleteNote(id, drawer.item.id, noteId);
      drawer.item = { ...drawer.item, notes: (drawer.item.notes ?? []).filter((n) => n.id !== noteId) };
    } catch (e) {
      drawer.error = errorMessage(i18n, e, "inbox.updateFailed");
    }
  });

  const promote = $(async () => {
    if (!drawer.item) return;
    drawer.busy = "promote";
    drawer.error = "";
    try {
      const res = await api.promoteFeedback(id, drawer.item.id);
      drawer.item = { ...res.item, notes: drawer.item.notes };
      state.items = state.items.map((it) => (it.id === res.item.id ? { ...it, ...res.item, notes: undefined } : it));
      refreshCounts();
    } catch (e) {
      drawer.error = errorMessage(i18n, e, "inbox.promoteFailed");
    } finally {
      drawer.busy = "";
    }
  });

  const merge = $(async (into: string) => {
    if (!drawer.item) return;
    if (drawer.mergeArmed !== into) {
      drawer.mergeArmed = into;
      return;
    }
    drawer.busy = "merge";
    drawer.error = "";
    try {
      const updated = await api.mergeFeedback(id, drawer.item.id, into);
      drawer.item = { ...updated, notes: updated.notes ?? drawer.item.notes, similar: [] };
      drawer.mergeArmed = "";
      state.items = state.hideDuplicates ? state.items.filter((it) => it.id !== updated.id) : state.items.map((it) => (it.id === updated.id ? { ...it, ...updated, notes: undefined } : it));
      api.getFeedback(id, into).then((t) => (drawer.dupTarget = t)).catch(() => {});
      refreshCounts();
    } catch (e) {
      drawer.error = errorMessage(i18n, e, "inbox.mergeFailed");
    } finally {
      drawer.busy = "";
    }
  });

  const sendReply = $(async () => {
    if (!drawer.item || !drawer.reply.trim()) return;
    drawer.busy = "reply";
    drawer.replyError = "";
    try {
      const note = await api.replyToReporter(id, drawer.item.id, drawer.reply.trim());
      drawer.item = { ...drawer.item, notes: [...(drawer.item.notes ?? []), note] };
      drawer.reply = "";
    } catch (e) {
      drawer.replyError = e instanceof ApiRequestError && e.error.code === "mail_disabled"
        ? tr(i18n, "inbox.replyMailOff")
        : e instanceof ApiRequestError && e.error.code === "no_reporter_email"
          ? tr(i18n, "inbox.replyNoEmail")
          : errorMessage(i18n, e, "inbox.replyFailed");
    } finally {
      drawer.busy = "";
    }
  });

  const remove = $(async () => {
    if (!drawer.item) return;
    if (!drawer.deleteArmed) {
      drawer.deleteArmed = true;
      return;
    }
    drawer.busy = "delete";
    try {
      const gone = drawer.item.id;
      await api.deleteFeedback(id, gone);
      state.items = state.items.filter((it) => it.id !== gone);
      state.total = Math.max(0, state.total - 1);
      await closeDrawer();
      refreshCounts();
    } catch (e) {
      drawer.error = errorMessage(i18n, e, "inbox.deleteFailed");
    } finally {
      drawer.busy = "";
    }
  });

  const resetFilters = $(() => {
    state.q = "";
    state.type = "";
    state.status = "";
    state.sentiment = "";
    state.priority = "";
    state.tag = "";
    state.hasScreenshot = false;
    state.page = 1;
  });

  const hasFilters = !!(state.q || state.type || state.status || state.sentiment || state.priority || state.tag || state.hasScreenshot);
  const pages = Math.max(1, Math.ceil(state.total / PER_PAGE));
  const item = drawer.item;
  const summary = state.summary;
  const liveFilters: SavedViewFilters = {
    q: state.q.trim() || undefined, type: state.type || undefined, status: state.status || undefined, sentiment: state.sentiment || undefined,
    priority: state.priority || undefined, tag: state.tag || undefined, has_screenshot: state.hasScreenshot || undefined, sort: state.sort,
  };
  const mailOn = features.mail !== false;

  return (
    <>
      <ProjectNav project={state.project} id={id} />
      <div class="mx-auto max-w-6xl px-4 py-6">
        {/* Summary strip */}
        {summary && (
          <div class="grid gap-3 sm:grid-cols-4">
            <button type="button" class="card p-4 text-left hover:border-primary-300" onClick$={() => { state.status = state.status === "new" ? "" : "new"; state.page = 1; }}>
              <div class="text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "status.new")}</div>
              <div class="mt-1 text-2xl font-bold text-primary-700">{summary.by_status.new ?? 0}</div>
            </button>
            <div class="card p-4">
              <div class="text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "inbox.last7")}</div>
              <div class="mt-1 text-2xl font-bold text-slate-900">{summary.last_7_days}</div>
            </div>
            <div class="card p-4">
              <div class="text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "inbox.byType")}</div>
              <div class="mt-1 flex gap-3 text-sm text-slate-700">
                <span title={tr(i18n, "type.bug")}>🐞 {summary.by_type.bug ?? 0}</span>
                <span title={tr(i18n, "type.feedback")}>💬 {summary.by_type.feedback ?? 0}</span>
                <span title={tr(i18n, "type.feature")}>💡 {summary.by_type.feature ?? 0}</span>
              </div>
            </div>
            <div class="card p-4">
              <div class="text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "inbox.sentiment")}</div>
              <div class="mt-1 flex gap-3 text-sm text-slate-700">
                <span>👍 {summary.by_sentiment.positive ?? 0}</span>
                <span>👎 {summary.by_sentiment.negative ?? 0}</span>
                <span>😐 {summary.by_sentiment.neutral ?? 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Views strip */}
        <div class="mt-6 flex flex-wrap items-center gap-1.5" role="tablist" aria-label={tr(i18n, "inbox.views")} data-testid="views">
          {VIRTUAL_VIEWS.map((v) => {
            const active = sameFilters(v.filters, liveFilters);
            return (
              <button key={v.id} type="button" role="tab" aria-selected={active} class={["rounded-full px-3 py-1 text-sm font-medium", active ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"]} onClick$={() => applyView(v.filters)}>
                {tr(i18n, v.label)}
              </button>
            );
          })}
          {state.views.map((v) => {
            const active = sameFilters(v.filters, liveFilters);
            return (
              <span key={v.id} class={["group inline-flex items-center rounded-full text-sm font-medium", active ? "bg-primary-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"]}>
                <button type="button" role="tab" aria-selected={active} class="px-3 py-1" onClick$={() => applyView(v.filters)}>{v.name}</button>
                <button type="button" class="pr-2 text-xs opacity-60 hover:opacity-100" aria-label={`${tr(i18n, "common.delete")}: ${v.name}`} onClick$={() => deleteView(v)}>×</button>
              </span>
            );
          })}
          {state.viewNameOpen ? (
            <form class="inline-flex items-center gap-1" preventdefault:submit onSubmit$={saveView}>
              <input type="text" class="input h-8 w-40 py-0 text-sm" placeholder={tr(i18n, "inbox.saveViewName")} value={state.viewName} onInput$={(_, el) => (state.viewName = el.value)} autoFocus />
              <button type="submit" class="btn-primary h-8 px-2 py-0 text-xs" disabled={state.viewBusy || !state.viewName.trim()}>{tr(i18n, "common.save")}</button>
              <button type="button" class="btn-ghost h-8 px-2 py-0 text-xs" onClick$={() => { state.viewNameOpen = false; state.viewName = ""; }}>{tr(i18n, "common.cancel")}</button>
            </form>
          ) : (
            hasFilters && <button type="button" class="btn-ghost text-xs" onClick$={() => (state.viewNameOpen = true)}>+ {tr(i18n, "inbox.saveView")}</button>
          )}
          {state.viewError && <span class="text-xs text-red-600">{state.viewError}</span>}
        </div>

        {/* Filter bar */}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            class="input w-full sm:w-64"
            placeholder={tr(i18n, "inbox.searchPlaceholder")}
            aria-label={tr(i18n, "common.search")}
            value={state.q}
            onInput$={(_, el) => { state.q = el.value; state.page = 1; }}
          />
          <select class="input w-auto" aria-label={tr(i18n, "inbox.filterType")} value={state.type} onChange$={(_, el) => { state.type = el.value; state.page = 1; }}>
            <option value="">{tr(i18n, "inbox.allTypes")}</option>
            {TYPES.map((t) => <option key={t} value={t} selected={t === state.type}>{tr(i18n, TYPE_LABEL[t])}</option>)}
          </select>
          <select class="input w-auto" aria-label={tr(i18n, "inbox.filterStatus")} value={state.status} onChange$={(_, el) => { state.status = el.value; state.page = 1; }}>
            <option value="">{tr(i18n, "inbox.allStatuses")}</option>
            <option value="new,triaged,planned,in_progress" selected={state.status === "new,triaged,planned,in_progress"}>{tr(i18n, "inbox.openOnly")}</option>
            {STATUSES.map((s) => <option key={s} value={s} selected={s === state.status}>{tr(i18n, STATUS_LABEL[s])}</option>)}
          </select>
          <select class="input w-auto" aria-label={tr(i18n, "inbox.filterSentiment")} value={state.sentiment} onChange$={(_, el) => { state.sentiment = el.value; state.page = 1; }}>
            <option value="">{tr(i18n, "inbox.allSentiments")}</option>
            {SENTIMENTS.map((s) => <option key={s} value={s} selected={s === state.sentiment}>{tr(i18n, SENTIMENT_LABEL[s])}</option>)}
          </select>
          <select class="input w-auto" aria-label={tr(i18n, "inbox.filterPriority")} value={state.priority} onChange$={(_, el) => { state.priority = el.value; state.page = 1; }}>
            <option value="">{tr(i18n, "inbox.allPriorities")}</option>
            {PRIORITIES.map((p) => <option key={p} value={p} selected={p === state.priority}>{tr(i18n, PRIORITY_LABEL[p])}</option>)}
          </select>
          {state.tags.length > 0 && (
            <select class="input w-auto" aria-label={tr(i18n, "inbox.filterTag")} value={state.tag} onChange$={(_, el) => { state.tag = el.value; state.page = 1; }}>
              <option value="">{tr(i18n, "inbox.allTags")}</option>
              {state.tags.map((t) => <option key={t.tag} value={t.tag} selected={t.tag === state.tag}>{`${t.tag} (${t.count})`}</option>)}
            </select>
          )}
          <label class="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={state.hasScreenshot} onChange$={(_, el) => { state.hasScreenshot = el.checked; state.page = 1; }} />
            {tr(i18n, "inbox.withScreenshot")}
          </label>
          <label class="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={state.hideDuplicates} onChange$={(_, el) => { state.hideDuplicates = el.checked; state.page = 1; }} />
            {tr(i18n, "inbox.hideDuplicates")}
          </label>
          <select class="input ml-auto w-auto" aria-label={tr(i18n, "inbox.sort")} value={state.sort} onChange$={(_, el) => (state.sort = el.value as "newest" | "oldest")}>
            <option value="newest" selected={state.sort === "newest"}>{tr(i18n, "inbox.sortNewest")}</option>
            <option value="oldest" selected={state.sort === "oldest"}>{tr(i18n, "inbox.sortOldest")}</option>
          </select>
          {hasFilters && (
            <button type="button" class="btn-ghost text-xs" onClick$={resetFilters}>
              {tr(i18n, "inbox.clearFilters")}
            </button>
          )}
        </div>

        {/* List */}
        <div class="mt-4 card overflow-hidden">
          {state.loading && state.items.length === 0 ? (
            <div class="p-10 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>
          ) : state.loadError ? (
            <div class="p-10 text-center text-sm text-red-600">
              {state.loadError}{" "}
              <button type="button" class="font-medium underline" onClick$={loadItems}>{tr(i18n, "common.retry")}</button>
            </div>
          ) : state.items.length === 0 ? (
            <div class="p-10 text-center text-sm text-slate-500">
              {hasFilters ? tr(i18n, "inbox.noMatch") : (
                <>
                  {tr(i18n, "inbox.empty")}{" "}
                  <Link href={`/dashboard/projects/${id}/settings`} class="font-medium text-primary-600 hover:underline">{tr(i18n, "inbox.emptyCta")}</Link>
                </>
              )}
            </div>
          ) : (
            <ul class="divide-y divide-slate-100" data-testid="feedback-list">
              {state.items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    class={["flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50", drawer.item?.id === it.id ? "bg-primary-50" : ""]}
                    onClick$={() => openItem(it)}
                  >
                    <span class="mt-0.5 text-lg" aria-hidden="true">{it.type === "bug" ? "🐞" : it.type === "feature" ? "💡" : "💬"}</span>
                    <span class="min-w-0 flex-1">
                      <span class="flex flex-wrap items-center gap-2">
                        <span class="font-mono text-xs text-slate-400">#{it.number}</span>
                        <span class={["truncate font-medium", it.status === "new" ? "text-slate-900" : "text-slate-700"]}>{it.title}</span>
                        <SentimentBadge sentiment={it.sentiment} />
                        {it.has_screenshot && <span class="text-xs text-slate-400" title={tr(i18n, "inbox.hasScreenshot")} aria-label={tr(i18n, "inbox.hasScreenshot")}>🖼</span>}
                      </span>
                      <span class="mt-0.5 block truncate text-sm text-slate-500">{it.message}</span>
                      <span class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <StatusBadge status={it.status} />
                        {it.duplicate_of && <span class="badge bg-slate-200 text-slate-600">⧉</span>}
                        <PriorityBadge priority={it.priority} />
                        {it.tags.map((t) => <span key={t} class="badge bg-slate-100 text-slate-600">{t}</span>)}
                        {it.page_url && <span class="truncate">{shortUrl(it.page_url)}</span>}
                        <span class="ml-auto whitespace-nowrap">{fmtDateTime(it.created_at, i18n.lang)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div class="mt-4 flex items-center justify-between text-sm text-slate-600">
            <button type="button" class="btn-secondary" disabled={state.page <= 1} onClick$={() => (state.page -= 1)}>←</button>
            <span>{tr(i18n, "inbox.pageOf", { page: state.page, pages, total: state.total })}</span>
            <button type="button" class="btn-secondary" disabled={state.page >= pages} onClick$={() => (state.page += 1)}>→</button>
          </div>
        )}
        {pages <= 1 && state.total > 0 && (
          <p class="mt-3 text-xs text-slate-400">{tr(i18n, "inbox.total", { total: state.total })}</p>
        )}
      </div>

      {/* Detail drawer */}
      {drawer.open && (
        <div class="fixed inset-0 z-40 flex justify-end">
          <button type="button" class="absolute inset-0 cursor-default bg-slate-900/30" aria-label={tr(i18n, "common.close")} tabIndex={-1} onClick$={closeDrawer} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={item ? `#${item.number} ${item.title}` : tr(i18n, "common.loading")}
            class="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl"
            onKeyDown$={(e) => { if (e.key === "Escape") closeDrawer(); }}
            data-testid="feedback-drawer"
          >
            <div class="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div class="min-w-0">
                {item && (
                  <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span class="font-mono">#{item.number}</span>
                    <TypeBadge type={item.type} />
                    <SentimentBadge sentiment={item.sentiment} />
                    <span class="badge bg-slate-100 text-slate-600">{item.source}</span>
                    <span>{fmtDateTime(item.created_at, i18n.lang)}</span>
                    {item.duplicate_of && (
                      <span class="badge bg-slate-200 text-slate-700" data-testid="duplicate-badge">
                        {drawer.dupTarget ? (
                          <button type="button" class="hover:underline" onClick$={() => openItem(drawer.dupTarget!)}>{tr(i18n, "inbox.duplicateOf", { number: drawer.dupTarget.number })}</button>
                        ) : "⧉"}
                      </span>
                    )}
                  </div>
                )}
                <h2 class="mt-1 text-lg font-semibold text-slate-900">{item?.title}</h2>
              </div>
              <button type="button" class="btn-ghost -mr-2 h-8 w-8 px-0" aria-label={tr(i18n, "common.close")} onClick$={closeDrawer}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>

            {drawer.error && <div class="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{drawer.error}</div>}

            {item && (
              <div class="flex-1 space-y-6 px-5 py-4">
                {/* Message */}
                <p class="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{item.message}</p>

                {/* Screenshot */}
                {item.has_screenshot && (
                  <div>
                    <div class="label">{tr(i18n, "inbox.screenshot")}{item.screenshot ? ` · ${fmtBytes(item.screenshot.size)}` : ""}</div>
                    {drawer.screenshotUrl ? (
                      <a href={drawer.screenshotUrl} target="_blank" rel="noreferrer">
                        <img src={drawer.screenshotUrl} alt={tr(i18n, "inbox.screenshot")} class="max-h-80 rounded-lg border border-slate-200" />
                      </a>
                    ) : (
                      <div class="grid h-32 place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">{tr(i18n, "common.loading")}</div>
                    )}
                  </div>
                )}

                {/* Triage */}
                <div class="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label class="label" for="fstatus">{tr(i18n, "inbox.status")}</label>
                    <select id="fstatus" class="input" value={item.status} disabled={!!drawer.busy} onChange$={(_, el) => patch({ status: el.value as FeedbackStatus }, "status")}>
                      {STATUSES.map((s) => <option key={s} value={s} selected={s === item.status}>{tr(i18n, STATUS_LABEL[s])}</option>)}
                    </select>
                  </div>
                  <div>
                    <label class="label" for="fpriority">{tr(i18n, "inbox.priority")}</label>
                    <select id="fpriority" class="input" value={item.priority} disabled={!!drawer.busy} onChange$={(_, el) => patch({ priority: el.value as Priority }, "priority")}>
                      {PRIORITIES.map((p) => <option key={p} value={p} selected={p === item.priority}>{tr(i18n, PRIORITY_LABEL[p])}</option>)}
                    </select>
                  </div>
                  <div class="sm:col-span-2">
                    <label class="label" for="ftags">{tr(i18n, "inbox.tags")}</label>
                    <div class="flex gap-2">
                      <input id="ftags" type="text" class="input" placeholder={tr(i18n, "inbox.tagsPlaceholder")} value={drawer.tagsText} onInput$={(_, el) => (drawer.tagsText = el.value)} onKeyDown$={(e) => { if (e.key === "Enter") patch({ tags: parseTags(drawer.tagsText) }, "tags"); }} />
                      <button type="button" class="btn-secondary" disabled={!!drawer.busy} onClick$={() => patch({ tags: parseTags(drawer.tagsText) }, "tags")}>
                        {drawer.busy === "tags" ? tr(i18n, "common.saving") : tr(i18n, "common.save")}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Roadmap */}
                <div class="rounded-lg border border-slate-200 p-3">
                  {item.roadmap_item_id ? (
                    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span class="text-slate-700">{tr(i18n, "inbox.onRoadmap")}</span>
                      <div class="flex gap-2">
                        <Link href={`/dashboard/projects/${id}/roadmap#${item.roadmap_item_id}`} class="btn-secondary text-xs">{tr(i18n, "inbox.viewRoadmap")}</Link>
                        <button type="button" class="btn-ghost text-xs" disabled={!!drawer.busy} onClick$={() => patch({ roadmap_item_id: null }, "unlink")}>{tr(i18n, "inbox.unlink")}</button>
                      </div>
                    </div>
                  ) : (
                    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span class="text-slate-700">{tr(i18n, "inbox.promoteHint")}</span>
                      <button type="button" class="btn-primary text-xs" disabled={!!drawer.busy} onClick$={promote}>
                        {drawer.busy === "promote" ? tr(i18n, "common.saving") : tr(i18n, "inbox.promote")}
                      </button>
                    </div>
                  )}
                </div>

                {/* Possible duplicates */}
                {!item.duplicate_of && (item.similar ?? []).length > 0 && (
                  <div class="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="possible-duplicates">
                    <h3 class="text-sm font-semibold text-amber-900">{tr(i18n, "inbox.possibleDuplicates")}</h3>
                    <ul class="mt-2 space-y-1.5">
                      {(item.similar ?? []).map((sim) => (
                        <li key={sim.id} class="flex flex-wrap items-center gap-2 text-sm">
                          <span class="font-mono text-xs text-slate-500">#{sim.number}</span>
                          <span class="min-w-0 flex-1 truncate text-slate-800">{sim.title}</span>
                          <StatusBadge status={sim.status} />
                          <span class="text-xs text-slate-500">{tr(i18n, "inbox.similarity", { pct: Math.round(sim.similarity * 100) })}</span>
                          <button type="button" class={drawer.mergeArmed === sim.id ? "btn bg-amber-500 px-2 py-1 text-xs text-white hover:bg-amber-600" : "btn-secondary px-2 py-1 text-xs"} disabled={!!drawer.busy} onClick$={() => merge(sim.id)}>
                            {drawer.mergeArmed === sim.id ? tr(i18n, "common.confirm") : tr(i18n, "inbox.mergeInto", { number: sim.number })}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {drawer.mergeArmed && (
                      <p class="mt-2 text-xs text-amber-800">
                        {tr(i18n, "inbox.mergeConfirm", { number: (item.similar ?? []).find((x) => x.id === drawer.mergeArmed)?.number ?? "" })}{" "}
                        <button type="button" class="underline" onClick$={() => (drawer.mergeArmed = "")}>{tr(i18n, "common.cancel")}</button>
                      </p>
                    )}
                  </div>
                )}

                {/* Reporter + context */}
                <dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                  {item.reporter_email && (<><dt class="text-slate-500">{tr(i18n, "common.email")}</dt><dd class="break-all text-slate-800"><a href={`mailto:${item.reporter_email}`} class="text-primary-600 hover:underline">{item.reporter_email}</a></dd></>)}
                  {item.reporter_id && (<><dt class="text-slate-500">{tr(i18n, "inbox.reporterId")}</dt><dd class="break-all font-mono text-xs text-slate-800">{item.reporter_id}</dd></>)}
                  {item.page_url && (<><dt class="text-slate-500">{tr(i18n, "inbox.pageUrl")}</dt><dd class="break-all text-slate-800"><a href={item.page_url} target="_blank" rel="noreferrer" class="text-primary-600 hover:underline">{item.page_url}</a></dd></>)}
                  {item.app_version && (<><dt class="text-slate-500">{tr(i18n, "inbox.appVersion")}</dt><dd class="font-mono text-xs text-slate-800">{item.app_version}</dd></>)}
                  {item.locale && (<><dt class="text-slate-500">{tr(i18n, "inbox.locale")}</dt><dd class="text-slate-800">{item.locale}</dd></>)}
                  {item.user_agent && (<><dt class="text-slate-500">{tr(i18n, "inbox.userAgent")}</dt><dd class="break-all text-xs text-slate-600">{item.user_agent}</dd></>)}
                </dl>
                {item.metadata && Object.keys(item.metadata).length > 0 && (
                  <details class="text-sm">
                    <summary class="cursor-pointer text-slate-600">{tr(i18n, "inbox.metadata")}</summary>
                    <pre class="mt-2 overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-800">{JSON.stringify(item.metadata, null, 2)}</pre>
                  </details>
                )}

                {/* Notes */}
                <div>
                  <h3 class="font-semibold text-slate-900">{tr(i18n, "inbox.notes")}</h3>
                  <ul class="mt-2 space-y-2">
                    {(item.notes ?? []).map((n) => (
                      <li key={n.id} class={["rounded-lg p-3 text-sm", n.kind === "reply" ? "border border-primary-200 bg-primary-50" : "bg-slate-50"]}>
                        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <span>
                            {n.kind === "reply" && (
                              <span class="badge mr-1 bg-primary-100 text-primary-800">
                                ✉ {tr(i18n, "inbox.replyBadge")}
                                {n.delivery && (
                                  <span class={["ml-1", n.delivery === "failed" ? "text-red-700" : n.delivery === "sent" ? "text-green-700" : "text-amber-700"]}>
                                    · {n.delivery === "sent" ? tr(i18n, "inbox.deliverySent") : n.delivery === "failed" ? tr(i18n, "inbox.deliveryFailed") : tr(i18n, "inbox.deliveryPending")}
                                  </span>
                                )}
                              </span>
                            )}
                            {n.author?.email ?? n.author?.label ?? tr(i18n, "audit.system")} · {fmtDateTime(n.created_at, i18n.lang)}
                          </span>
                          {n.kind !== "reply" && <button type="button" class="text-red-600 hover:underline" onClick$={() => deleteNote(n.id)}>{tr(i18n, "common.delete")}</button>}
                        </div>
                        <p class="mt-1 whitespace-pre-wrap text-slate-800">{n.body}</p>
                      </li>
                    ))}
                    {(item.notes ?? []).length === 0 && <li class="text-sm text-slate-400">{tr(i18n, "inbox.noNotes")}</li>}
                  </ul>
                  <form class="mt-3 flex gap-2" preventdefault:submit onSubmit$={addNote}>
                    <input type="text" class="input" placeholder={tr(i18n, "inbox.notePlaceholder")} value={drawer.note} onInput$={(_, el) => (drawer.note = el.value)} />
                    <button type="submit" class="btn-secondary" disabled={!!drawer.busy || !drawer.note.trim()}>{tr(i18n, "inbox.addNote")}</button>
                  </form>
                </div>

                {/* Reply to the reporter */}
                <div class="rounded-lg border border-slate-200 p-3" data-testid="reply">
                  <h3 class="font-semibold text-slate-900">{tr(i18n, "inbox.replyTitle")}</h3>
                  {!item.reporter_email ? (
                    <p class="mt-1 text-sm text-slate-500">{tr(i18n, "inbox.replyNoEmail")}</p>
                  ) : !mailOn ? (
                    <p class="mt-1 text-sm text-slate-500">{tr(i18n, "inbox.replyMailOff")}</p>
                  ) : (
                    <form class="mt-2 space-y-2" preventdefault:submit onSubmit$={sendReply}>
                      <p class="text-xs text-slate-500">{tr(i18n, "inbox.replyBody")}</p>
                      <textarea class="input" rows={3} placeholder={tr(i18n, "inbox.replyPlaceholder")} value={drawer.reply} onInput$={(_, el) => (drawer.reply = el.value)} />
                      {drawer.replyError && <p class="text-sm text-red-600">{drawer.replyError}</p>}
                      <div class="flex items-center justify-between gap-2">
                        <span class="truncate text-xs text-slate-500">→ {item.reporter_email}</span>
                        <button type="submit" class="btn-primary" disabled={!!drawer.busy || !drawer.reply.trim()}>
                          {drawer.busy === "reply" ? tr(i18n, "common.sending") : tr(i18n, "common.send")}
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Delete */}
                <div class="border-t border-slate-200 pt-4">
                  <button type="button" class={drawer.deleteArmed ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-ghost text-red-600"} disabled={drawer.busy === "delete"} onClick$={remove}>
                    {drawer.deleteArmed ? tr(i18n, "inbox.deleteConfirm") : tr(i18n, "inbox.delete")}
                  </button>
                  {drawer.deleteArmed && (
                    <button type="button" class="btn-ghost ml-2" onClick$={() => (drawer.deleteArmed = false)}>{tr(i18n, "common.cancel")}</button>
                  )}
                </div>
              </div>
            )}
            {!item && drawer.loading && <div class="p-10 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>}
          </aside>
        </div>
      )}
    </>
  );
});

export const head: DocumentHead = { title: "Inbox — retro" };
