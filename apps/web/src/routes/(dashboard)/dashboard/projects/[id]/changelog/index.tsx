import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { useLocation, useNavigate, type DocumentHead } from "@builder.io/qwik-city";
import { api, ApiRequestError } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { fmtDate } from "../../../../../../lib/feedback";
import { Modal } from "../../../../../../components/modal";
import { ProjectNav } from "../../../../../../components/project-nav";
import { MarkdownView } from "../../../../../../components/markdown-view";
import { tr, useI18n } from "../../../../../../i18n";
import type { ChangelogEntry, Project } from "../../../../../../lib/types";

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const i18n = useI18n();
  const id = loc.params.id;

  const state = useStore<{ project: Project | null; items: ChangelogEntry[]; loading: boolean; error: string; busy: string }>({
    project: null,
    items: [],
    loading: true,
    error: "",
    busy: "",
  });

  const form = useStore<{
    open: boolean;
    editing: ChangelogEntry | null;
    title: string;
    version: string;
    body: string;
    submitting: boolean;
    error: string;
    deleteArmed: boolean;
  }>({ open: false, editing: null, title: "", version: "", body: "", submitting: false, error: "", deleteArmed: false });

  const load = $(async () => {
    state.loading = true;
    state.error = "";
    try {
      const [project, res] = await Promise.all([api.getProject(id), api.listChangelog(id)]);
      state.project = project;
      state.items = res.items;
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        nav("/login");
        return;
      }
      state.error = errorMessage(i18n, e, "changelog.loadFailed");
    } finally {
      state.loading = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    load();
  });

  const openNew = $(() => {
    form.open = true;
    form.editing = null;
    form.title = "";
    form.version = "";
    form.body = "";
    form.error = "";
    form.deleteArmed = false;
  });

  const openEdit = $((entry: ChangelogEntry) => {
    form.open = true;
    form.editing = entry;
    form.title = entry.title;
    form.version = entry.version ?? "";
    form.body = entry.body;
    form.error = "";
    form.deleteArmed = false;
  });

  const close = $(() => {
    form.open = false;
    form.editing = null;
  });

  const save = $(async (publish: boolean) => {
    form.submitting = true;
    form.error = "";
    try {
      if (form.editing) {
        const updated = await api.updateChangelogEntry(id, form.editing.id, {
          title: form.title.trim(),
          body: form.body,
          version: form.version.trim() || null,
          ...(publish ? { published: true } : {}),
        });
        state.items = state.items.map((it) => (it.id === updated.id ? updated : it));
      } else {
        const created = await api.createChangelogEntry(id, {
          title: form.title.trim(),
          body: form.body,
          version: form.version.trim() || undefined,
          publish,
        });
        state.items = [created, ...state.items];
      }
      form.open = false;
      form.editing = null;
    } catch (e) {
      form.error = errorMessage(i18n, e, "changelog.saveFailed");
    } finally {
      form.submitting = false;
    }
  });

  const setPublished = $(async (entry: ChangelogEntry, published: boolean) => {
    state.busy = entry.id;
    try {
      const updated = await api.updateChangelogEntry(id, entry.id, { published });
      state.items = state.items.map((it) => (it.id === updated.id ? updated : it));
    } catch (e) {
      state.error = errorMessage(i18n, e, "changelog.saveFailed");
    } finally {
      state.busy = "";
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
      await api.deleteChangelogEntry(id, gone);
      state.items = state.items.filter((it) => it.id !== gone);
      form.open = false;
      form.editing = null;
    } catch (e) {
      form.error = errorMessage(i18n, e, "changelog.deleteFailed");
    } finally {
      form.submitting = false;
    }
  });

  const drafts = state.items.filter((it) => !it.published_at);
  const published = state.items.filter((it) => !!it.published_at);

  const Entry = (entry: ChangelogEntry) => (
    <li key={entry.id} class={["card p-5", state.busy === entry.id ? "opacity-60" : ""]}>
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {entry.version && <span class="badge bg-primary-100 text-primary-800 font-mono">{entry.version}</span>}
            {entry.published_at ? (
              <span>{fmtDate(entry.published_at, i18n.lang)}</span>
            ) : (
              <span class="badge bg-amber-100 text-amber-800">{tr(i18n, "changelog.draft")}</span>
            )}
          </div>
          <h3 class="mt-1 text-lg font-semibold text-slate-900">{entry.title}</h3>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn-secondary text-xs" onClick$={() => openEdit(entry)}>{tr(i18n, "common.edit")}</button>
          {entry.published_at ? (
            <button type="button" class="btn-ghost text-xs" disabled={!!state.busy} onClick$={() => setPublished(entry, false)}>{tr(i18n, "changelog.unpublish")}</button>
          ) : (
            <button type="button" class="btn-primary text-xs" disabled={!!state.busy} onClick$={() => setPublished(entry, true)}>{tr(i18n, "changelog.publish")}</button>
          )}
        </div>
      </div>
      <MarkdownView source={entry.body} class="mt-3 text-sm" />
    </li>
  );

  return (
    <>
      <ProjectNav project={state.project} id={id} />
      <div class="mx-auto max-w-4xl px-4 py-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-slate-600">
            {tr(i18n, "changelog.intro")}{" "}
            {state.project?.board_enabled && state.project.board_url && (
              <a href={`${state.project.board_url}/changelog`} target="_blank" rel="noreferrer" class="text-primary-600 hover:underline">{tr(i18n, "changelog.viewPublic")} ↗</a>
            )}
          </p>
          <button type="button" class="btn-primary" onClick$={openNew}>{tr(i18n, "changelog.newEntry")}</button>
        </div>

        {state.error && <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}

        {state.loading ? (
          <div class="mt-6 card p-10 text-center text-sm text-slate-400">{tr(i18n, "common.loading")}</div>
        ) : state.items.length === 0 ? (
          <div class="mt-6 card p-10 text-center text-sm text-slate-500">{tr(i18n, "changelog.empty")}</div>
        ) : (
          <>
            {drafts.length > 0 && (
              <section class="mt-6">
                <h2 class="text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "changelog.drafts")}</h2>
                <ul class="mt-2 space-y-4">{drafts.map(Entry)}</ul>
              </section>
            )}
            {published.length > 0 && (
              <section class="mt-8">
                <h2 class="text-xs uppercase tracking-wide text-slate-500">{tr(i18n, "changelog.published")}</h2>
                <ul class="mt-2 space-y-4">{published.map(Entry)}</ul>
              </section>
            )}
          </>
        )}
      </div>

      <Modal open={form.open} title={form.editing ? tr(i18n, "changelog.editEntry") : tr(i18n, "changelog.newEntry")} onClose$={close} wide>
        <form class="space-y-4" preventdefault:submit onSubmit$={() => save(false)}>
          {form.error && <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{form.error}</div>}
          <div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div>
              <label class="label" for="ctitle">{tr(i18n, "changelog.title")}</label>
              <input id="ctitle" type="text" required class="input" value={form.title} onInput$={(_, el) => (form.title = el.value)} />
            </div>
            <div>
              <label class="label" for="cversion">{tr(i18n, "changelog.version")} <span class="text-slate-400">{tr(i18n, "common.optional")}</span></label>
              <input id="cversion" type="text" class="input font-mono" placeholder="1.2.0" value={form.version} onInput$={(_, el) => (form.version = el.value)} />
            </div>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label class="label" for="cbody">{tr(i18n, "changelog.body")} <span class="text-slate-400">{tr(i18n, "common.markdown")}</span></label>
              <textarea id="cbody" class="input font-mono text-xs" rows={14} value={form.body} onInput$={(_, el) => (form.body = el.value)} />
            </div>
            <div>
              <div class="label">{tr(i18n, "common.preview")}</div>
              <div class="min-h-[8rem] rounded-lg border border-slate-200 p-3 text-sm">
                {form.body.trim() ? <MarkdownView source={form.body} /> : <span class="text-slate-400">—</span>}
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              {form.editing && (
                <button type="button" class={form.deleteArmed ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-ghost text-red-600"} disabled={form.submitting} onClick$={remove}>
                  {form.deleteArmed ? tr(i18n, "changelog.deleteConfirm") : tr(i18n, "common.delete")}
                </button>
              )}
            </div>
            <div class="flex gap-2">
              <button type="button" class="btn-secondary" onClick$={close}>{tr(i18n, "common.cancel")}</button>
              <button type="submit" class="btn-secondary" disabled={form.submitting || !form.title.trim()}>
                {form.editing?.published_at ? tr(i18n, "common.save") : tr(i18n, "changelog.saveDraft")}
              </button>
              {!form.editing?.published_at && (
                <button type="button" class="btn-primary" disabled={form.submitting || !form.title.trim()} onClick$={() => save(true)}>
                  {form.submitting ? tr(i18n, "common.saving") : tr(i18n, "changelog.publish")}
                </button>
              )}
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
});

export const head: DocumentHead = { title: "Changelog — retro" };
