import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { useLocation, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../../../../lib/api";
import { errorMessage, isLimitError } from "../../../../../../lib/errors";
import { ROADMAP_STATUSES, fmtDate } from "../../../../../../lib/feedback";
import { Modal } from "../../../../../../components/modal";
import { Switch } from "../../../../../../components/switch";
import { ProjectNav } from "../../../../../../components/project-nav";
import { MarkdownView } from "../../../../../../components/markdown-view";
import { tr, useI18n } from "../../../../../../i18n";
import type { CatalogKey } from "../../../../../../i18n/catalog/en";
import type { Project, RoadmapItem, RoadmapStatus } from "../../../../../../lib/types";

const COLUMN_LABEL: Record<RoadmapStatus, CatalogKey> = {
  planned: "status.planned",
  in_progress: "status.in_progress",
  done: "status.done",
};

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const i18n = useI18n();
  const id = loc.params.id;

  const state = useStore<{
    project: Project | null;
    items: RoadmapItem[];
    loading: boolean;
    error: string;
    busy: string;
  }>({ project: null, items: [], loading: true, error: "", busy: "" });

  const form = useStore<{
    open: boolean;
    editing: RoadmapItem | null;
    title: string;
    description: string;
    status: RoadmapStatus;
    isPublic: boolean;
    submitting: boolean;
    error: string;
    limitReached: boolean;
    deleteArmed: boolean;
  }>({ open: false, editing: null, title: "", description: "", status: "planned", isPublic: true, submitting: false, error: "", limitReached: false, deleteArmed: false });

  const load = $(async () => {
    state.loading = true;
    state.error = "";
    try {
      const [project, roadmap] = await Promise.all([api.getProject(id), api.listRoadmap(id)]);
      state.project = project;
      state.items = roadmap.items;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.error = errorMessage(i18n, e, "roadmap.loadFailed");
    } finally {
      state.loading = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    load();
  });

  const openNew = $((status: RoadmapStatus) => {
    form.open = true;
    form.editing = null;
    form.title = "";
    form.description = "";
    form.status = status;
    form.isPublic = true;
    form.error = "";
    form.limitReached = false;
    form.deleteArmed = false;
  });

  const openEdit = $((item: RoadmapItem) => {
    form.open = true;
    form.editing = item;
    form.title = item.title;
    form.description = item.description ?? "";
    form.status = item.status;
    form.isPublic = item.public;
    form.error = "";
    form.limitReached = false;
    form.deleteArmed = false;
  });

  const close = $(() => {
    form.open = false;
    form.editing = null;
  });

  const submit = $(async () => {
    form.submitting = true;
    form.error = "";
    form.limitReached = false;
    try {
      if (form.editing) {
        const updated = await api.updateRoadmapItem(id, form.editing.id, {
          title: form.title.trim(),
          description: form.description.trim() || null,
          status: form.status,
          public: form.isPublic,
        });
        state.items = state.items.map((it) => (it.id === updated.id ? updated : it));
      } else {
        const created = await api.createRoadmapItem(id, {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          status: form.status,
          public: form.isPublic,
        });
        state.items = [...state.items, created];
      }
      form.open = false;
      form.editing = null;
    } catch (e) {
      form.limitReached = isLimitError(e);
      form.error = errorMessage(i18n, e, "roadmap.saveFailed");
    } finally {
      form.submitting = false;
    }
  });

  const remove = $(async () => {
    if (!form.editing) return;
    if (!form.deleteArmed) {
      form.deleteArmed = true;
      return;
    }
    form.submitting = true;
    try {
      const gone = form.editing.id;
      await api.deleteRoadmapItem(id, gone);
      state.items = state.items.filter((it) => it.id !== gone);
      form.open = false;
      form.editing = null;
    } catch (e) {
      form.error = errorMessage(i18n, e, "roadmap.deleteFailed");
    } finally {
      form.submitting = false;
    }
  });

  const togglePublic = $(async (item: RoadmapItem, next: boolean) => {
    state.busy = item.id;
    try {
      const updated = await api.updateRoadmapItem(id, item.id, { public: next });
      state.items = state.items.map((it) => (it.id === updated.id ? updated : it));
    } catch (e) {
      state.error = errorMessage(i18n, e, "roadmap.saveFailed");
    } finally {
      state.busy = "";
    }
  });

  const moveTo = $(async (item: RoadmapItem, status: RoadmapStatus) => {
    state.busy = item.id;
    try {
      const updated = await api.updateRoadmapItem(id, item.id, { status });
      state.items = state.items.map((it) => (it.id === updated.id ? updated : it));
    } catch (e) {
      state.error = errorMessage(i18n, e, "roadmap.saveFailed");
    } finally {
      state.busy = "";
    }
  });

  /** Swap with the neighbour in the same column and persist the new order. */
  const nudge = $(async (item: RoadmapItem, dir: -1 | 1) => {
    const column = state.items.filter((it) => it.status === item.status).sort((a, b) => a.position - b.position);
    const idx = column.findIndex((it) => it.id === item.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= column.length) return;
    const ids = column.map((it) => it.id);
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    state.busy = item.id;
    try {
      const res = await api.reorderRoadmap(id, item.status, ids);
      const byId = new Map(res.items.map((it) => [it.id, it]));
      state.items = state.items.map((it) => byId.get(it.id) ?? it);
    } catch (e) {
      state.error = errorMessage(i18n, e, "roadmap.saveFailed");
    } finally {
      state.busy = "";
    }
  });

  const columns = ROADMAP_STATUSES.map((status) => ({
    status,
    items: state.items.filter((it) => it.status === status).sort((a, b) => a.position - b.position),
  }));

  return (
    <>
      <ProjectNav project={state.project} id={id} />
      <div class="mx-auto max-w-6xl px-4 py-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-slate-600">
            {tr(i18n, "roadmap.intro")}{" "}
            {state.project && !state.project.board_enabled && (
              <span class="text-amber-700">{tr(i18n, "roadmap.boardOff")}</span>
            )}
          </p>
          <button type="button" class="btn-primary" onClick$={() => openNew("planned")}>
            {tr(i18n, "roadmap.newItem")}
          </button>
        </div>

        {state.error && <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}

        {state.loading ? (
          <div class="mt-6 card p-10 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>
        ) : (
          <div class="mt-6 grid gap-4 lg:grid-cols-3">
            {columns.map((col) => (
              <section key={col.status} class="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid={`column-${col.status}`}>
                <header class="flex items-center justify-between px-1">
                  <h2 class="font-semibold text-slate-900">
                    {tr(i18n, COLUMN_LABEL[col.status])}
                    <span class="ml-2 rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{col.items.length}</span>
                  </h2>
                  <button type="button" class="btn-ghost h-7 px-2 text-xs" onClick$={() => openNew(col.status)} aria-label={tr(i18n, "roadmap.newItem")}>+</button>
                </header>
                <ul class="mt-3 space-y-2">
                  {col.items.length === 0 && <li class="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400">{tr(i18n, "roadmap.emptyColumn")}</li>}
                  {col.items.map((it, idx) => (
                    <li key={it.id} id={it.id} class={["card p-3", state.busy === it.id ? "opacity-60" : ""]}>
                      <div class="flex items-start justify-between gap-2">
                        <button type="button" class="min-w-0 flex-1 text-left" onClick$={() => openEdit(it)}>
                          <div class="font-medium text-slate-900">{it.title}</div>
                          {it.description && <div class="mt-1 line-clamp-2 text-xs text-slate-500">{it.description}</div>}
                        </button>
                        <div class="flex flex-col gap-1">
                          <button type="button" class="btn-ghost h-6 w-6 px-0 text-xs" disabled={idx === 0 || !!state.busy} aria-label={tr(i18n, "roadmap.moveUp")} onClick$={() => nudge(it, -1)}>↑</button>
                          <button type="button" class="btn-ghost h-6 w-6 px-0 text-xs" disabled={idx === col.items.length - 1 || !!state.busy} aria-label={tr(i18n, "roadmap.moveDown")} onClick$={() => nudge(it, 1)}>↓</button>
                        </div>
                      </div>
                      <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span title={tr(i18n, "roadmap.votes")}>▲ {it.votes}</span>
                        <span title={tr(i18n, "roadmap.linkedFeedback")}>💬 {it.feedback_count}</span>
                        {it.completed_at && <span>{fmtDate(it.completed_at, i18n.lang)}</span>}
                        <span class="ml-auto flex items-center gap-1.5">
                          <span>{tr(i18n, "roadmap.public")}</span>
                          <Switch small checked={it.public} label={tr(i18n, "roadmap.public")} disabled={!!state.busy} onToggle$={(next) => togglePublic(it, next)} />
                        </span>
                      </div>
                      <div class="mt-2 flex gap-1">
                        {ROADMAP_STATUSES.filter((s) => s !== it.status).map((s) => (
                          <button key={s} type="button" class="btn-secondary h-6 px-2 text-[11px]" disabled={!!state.busy} onClick$={() => moveTo(it, s)}>
                            → {tr(i18n, COLUMN_LABEL[s])}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <Modal open={form.open} title={form.editing ? tr(i18n, "roadmap.editItem") : tr(i18n, "roadmap.newItem")} onClose$={close} wide>
        <form class="space-y-4" preventdefault:submit onSubmit$={submit}>
          {form.error && (
            <div class={["rounded-lg border px-3 py-2 text-sm", form.limitReached ? "border-amber-300 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"]}>{form.error}</div>
          )}
          <div>
            <label class="label" for="rtitle">{tr(i18n, "roadmap.title")}</label>
            <input id="rtitle" type="text" required class="input" value={form.title} onInput$={(_, el) => (form.title = el.value)} />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="rdesc">{tr(i18n, "roadmap.description")} <span class="text-slate-400">{tr(i18n, "common.markdown")}</span></label>
              <textarea id="rdesc" class="input font-mono text-xs" rows={8} value={form.description} onInput$={(_, el) => (form.description = el.value)} />
            </div>
            <div>
              <div class="label">{tr(i18n, "common.preview")}</div>
              <div class="min-h-[8rem] rounded-lg border border-slate-200 p-3 text-sm">
                {form.description.trim() ? <MarkdownView source={form.description} /> : <span class="text-slate-400">—</span>}
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-end gap-4">
            <div>
              <label class="label" for="rstatus">{tr(i18n, "inbox.status")}</label>
              <select id="rstatus" class="input" value={form.status} onChange$={(_, el) => (form.status = el.value as RoadmapStatus)}>
                {ROADMAP_STATUSES.map((s) => <option key={s} value={s} selected={s === form.status}>{tr(i18n, COLUMN_LABEL[s])}</option>)}
              </select>
            </div>
            <label class="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <Switch checked={form.isPublic} label={tr(i18n, "roadmap.public")} onToggle$={(next) => (form.isPublic = next)} />
              {tr(i18n, "roadmap.publicHint")}
            </label>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              {form.editing && (
                <>
                  <button type="button" class={form.deleteArmed ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-ghost text-red-600"} disabled={form.submitting} onClick$={remove}>
                    {form.deleteArmed ? tr(i18n, "roadmap.deleteConfirm") : tr(i18n, "common.delete")}
                  </button>
                  {form.editing.feedback_count > 0 && <span class="ml-2 text-xs text-slate-500">{tr(i18n, "roadmap.deleteNote", { n: form.editing.feedback_count })}</span>}
                </>
              )}
            </div>
            <div class="flex gap-2">
              <button type="button" class="btn-secondary" onClick$={close}>{tr(i18n, "common.cancel")}</button>
              <button type="submit" class="btn-primary" disabled={form.submitting || !form.title.trim()}>
                {form.submitting ? tr(i18n, "common.saving") : tr(i18n, "common.save")}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
});

export const head: DocumentHead = { title: "Roadmap — retro" };
