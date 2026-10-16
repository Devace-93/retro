import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { ApiRequestError } from "../../../../lib/api";
import { turnstileToken, loadTurnstile } from "../../../../lib/turnstile";
import { Link, useLocation, type DocumentHead } from "@builder.io/qwik-city";
import { useBoard } from "./layout";
import { api } from "../../../../lib/api";
import { ROADMAP_STATUSES, TYPE_ICON, TYPE_LABEL, fmtDate, saveVoted, votedSet, voterId } from "../../../../lib/feedback";
import { MarkdownView } from "../../../../components/markdown-view";
import { BoardNotFound } from "../../../../components/board-not-found";
import { tr, useI18n } from "../../../../i18n";
import type { CatalogKey } from "../../../../i18n/catalog/en";
import type { FeedbackType, RoadmapStatus } from "../../../../lib/types";

const TAB_LABEL: Record<RoadmapStatus, CatalogKey> = {
  planned: "status.planned",
  in_progress: "status.in_progress",
  done: "status.done",
};

export default component$(() => {
  const loc = useLocation();
  const result = useBoard();
  const i18n = useI18n();
  const slug = loc.params.slug;

  const state = useStore<{
    tab: RoadmapStatus;
    votes: Record<string, number>;
    voted: string[];
    busy: string;
    error: string;
  }>({ tab: "planned", votes: {}, voted: [], busy: "", error: "" });

  const form = useStore<{
    open: boolean;
    type: FeedbackType;
    message: string;
    email: string;
    website: string;
    submitting: boolean;
    error: string;
    done: number | null;
    turnstileReady: boolean;
  }>({ open: false, type: "feature", message: "", email: "", website: "", submitting: false, error: "", done: null, turnstileReady: false });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    state.voted = [...votedSet(slug)];
    if (result.value.ok) {
      const types = result.value.board.types_enabled;
      if (!types.includes(form.type)) form.type = types[0] ?? "feedback";
      // Cloudflare Turnstile is loaded lazily, only when the project asks for it.
      if (result.value.board.turnstile_site_key && result.value.board.can_submit) {
        loadTurnstile().then(() => (form.turnstileReady = true)).catch(() => {});
      }
    }
  });

  const toggleVote = $(async (rid: string, current: number) => {
    state.busy = rid;
    state.error = "";
    const has = state.voted.includes(rid);
    // optimistic
    state.votes = { ...state.votes, [rid]: Math.max(0, current + (has ? -1 : 1)) };
    state.voted = has ? state.voted.filter((x) => x !== rid) : [...state.voted, rid];
    try {
      const res = has ? await api.unvote(slug, rid, voterId()) : await api.vote(slug, rid, voterId());
      state.votes = { ...state.votes, [rid]: res.votes };
      if (res.voted && !state.voted.includes(rid)) state.voted = [...state.voted, rid];
      if (!res.voted) state.voted = state.voted.filter((x) => x !== rid);
      saveVoted(slug, new Set(state.voted));
    } catch {
      // roll back
      state.votes = { ...state.votes, [rid]: current };
      state.voted = has ? [...state.voted, rid] : state.voted.filter((x) => x !== rid);
      state.error = tr(i18n, "board.voteFailed");
    } finally {
      state.busy = "";
    }
  });

  const submit = $(async () => {
    form.submitting = true;
    form.error = "";
    try {
      const siteKey = result.value.ok ? result.value.board.turnstile_site_key : null;
      const turnstile_token = siteKey ? await turnstileToken(siteKey, "#board-turnstile") : undefined;
      const res = await api.boardSubmit(slug, {
        type: form.type,
        message: form.message.trim(),
        email: form.email.trim() || undefined,
        website: form.website,
        turnstile_token,
      });
      form.done = res.number;
      form.message = "";
      form.email = "";
    } catch (e) {
      form.error = e instanceof ApiRequestError && e.error.code === "captcha_failed"
        ? tr(i18n, "board.captchaFailed")
        : (e as Error)?.message || tr(i18n, "board.submitFailed");
    } finally {
      form.submitting = false;
    }
  });

  if (!result.value.ok) return <BoardNotFound />;
  const board = result.value.board;
  const title = board.project.board_title || board.project.name;
  const items = board.roadmap[state.tab] ?? [];

  return (
    <div class="mx-auto max-w-4xl px-4 py-12">
      <header class="text-center">
        <p class="text-xs uppercase tracking-wide text-primary-600">{tr(i18n, "board.kicker")}</p>
        <h1 class="mt-2 text-4xl font-bold tracking-tight text-slate-900">{title}</h1>
        {board.project.url && (
          <a href={board.project.url} class="mt-2 inline-block text-sm text-slate-500 hover:text-primary-600" rel="noreferrer">
            {board.project.url.replace(/^https?:\/\//, "")} ↗
          </a>
        )}
        {board.project.board_intro && <MarkdownView source={board.project.board_intro} class="mx-auto mt-4 max-w-2xl text-left" />}
      </header>

      <nav class="mt-10 flex flex-wrap items-center justify-center gap-1" aria-label={tr(i18n, "board.roadmap")}>
        {ROADMAP_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            class={["rounded-lg px-4 py-2 text-sm font-medium", state.tab === s ? "bg-primary-600 text-white" : "text-slate-600 hover:bg-slate-100"]}
            aria-pressed={state.tab === s}
            onClick$={() => (state.tab = s)}
          >
            {tr(i18n, TAB_LABEL[s])}
            <span class="ml-1.5 text-xs opacity-70">{(board.roadmap[s] ?? []).length}</span>
          </button>
        ))}
        <Link href={`/b/${slug}/changelog`} class="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          {tr(i18n, "board.changelog")}
          <span class="ml-1.5 text-xs opacity-70">{board.changelog.length}</span>
        </Link>
      </nav>

      {state.error && <p class="mt-4 text-center text-sm text-red-600">{state.error}</p>}

      <ul class="mt-6 space-y-3" data-testid="board-items">
        {items.length === 0 && <li class="card p-10 text-center text-sm text-slate-500">{tr(i18n, "board.emptyColumn")}</li>}
        {items.map((it) => {
          const votes = state.votes[it.id] ?? it.votes;
          const voted = state.voted.includes(it.id);
          return (
            <li key={it.id} class="card flex gap-4 p-5">
              {board.can_vote && it.status !== "done" ? (
                <button
                  type="button"
                  class={[
                    "flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-lg border text-sm font-semibold",
                    voted ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600 hover:border-primary-300",
                  ]}
                  aria-pressed={voted}
                  aria-label={tr(i18n, "board.vote")}
                  disabled={state.busy === it.id}
                  onClick$={() => toggleVote(it.id, votes)}
                >
                  <span aria-hidden="true">▲</span>
                  <span>{votes}</span>
                </button>
              ) : (
                <div class="flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-50 text-sm font-semibold text-slate-500">
                  <span aria-hidden="true">▲</span>
                  <span>{votes}</span>
                </div>
              )}
              <div class="min-w-0 flex-1">
                <h2 class="font-semibold text-slate-900">{it.title}</h2>
                {it.description && <MarkdownView source={it.description} class="mt-1 text-sm" />}
                {it.completed_at && <p class="mt-2 text-xs text-slate-500">{tr(i18n, "board.completedOn", { date: fmtDate(it.completed_at, i18n.lang) })}</p>}
              </div>
            </li>
          );
        })}
      </ul>

      {board.can_submit && (
        <section class="mt-12 card p-6" id="submit">
          {form.done !== null ? (
            <div class="text-center" data-testid="board-submitted">
              <p class="text-lg font-semibold text-slate-900">{tr(i18n, "board.thanksTitle")}</p>
              <p class="mt-1 text-sm text-slate-600">{tr(i18n, "board.thanksBody", { number: form.done })}</p>
              <button type="button" class="btn-secondary mt-4" onClick$={() => (form.done = null)}>{tr(i18n, "board.submitAnother")}</button>
            </div>
          ) : (
            <>
              <h2 class="text-lg font-semibold text-slate-900">{tr(i18n, "board.submitTitle")}</h2>
              <p class="mt-1 text-sm text-slate-600">{tr(i18n, "board.submitBody")}</p>
              <form class="mt-4 space-y-4" preventdefault:submit onSubmit$={submit}>
                {form.error && <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{form.error}</div>}
                <div class="flex flex-wrap gap-2" role="radiogroup" aria-label={tr(i18n, "board.type")}>
                  {board.types_enabled.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={form.type === t}
                      class={["rounded-lg border px-3 py-2 text-sm", form.type === t ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-700 hover:border-primary-300"]}
                      onClick$={() => (form.type = t)}
                    >
                      <span aria-hidden="true">{TYPE_ICON[t]}</span> {tr(i18n, TYPE_LABEL[t])}
                    </button>
                  ))}
                </div>
                <div>
                  <label class="label" for="bmessage">{tr(i18n, "board.message")}</label>
                  <textarea id="bmessage" class="input" rows={4} required minLength={1} maxLength={5000} value={form.message} onInput$={(_, el) => (form.message = el.value)} />
                </div>
                <div>
                  <label class="label" for="bemail">{tr(i18n, "common.email")} <span class="text-slate-400">{tr(i18n, "common.optional")}</span></label>
                  <input id="bemail" type="email" class="input" autoComplete="email" value={form.email} onInput$={(_, el) => (form.email = el.value)} />
                </div>
                {/* Honeypot: real people never see or fill this. */}
                <div class="hidden" aria-hidden="true">
                  <label for="website">Website</label>
                  <input id="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onInput$={(_, el) => (form.website = el.value)} />
                </div>
                {board.turnstile_site_key && <div id="board-turnstile" class="min-h-[1px]" data-testid="turnstile" />}
                <div class="flex justify-end">
                  <button type="submit" class="btn-primary" disabled={form.submitting || !form.message.trim()}>
                    {form.submitting ? tr(i18n, "board.sending") : tr(i18n, "board.send")}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      )}

      <p class="mt-10 text-center text-xs text-slate-400">
        {tr(i18n, "board.poweredBy")}{" "}
        <Link href="/" class="font-medium text-primary-600 hover:underline">retro</Link>
      </p>
    </div>
  );
});

export const head: DocumentHead = ({ resolveValue, url }) => {
  const result = resolveValue(useBoard);
  if (!result.ok) return { title: "Board not found — retro" };
  const b = result.board;
  const title = `${b.project.board_title || b.project.name} — roadmap`;
  const description = b.project.board_intro?.slice(0, 160) || `Roadmap and changelog of ${b.project.name}: vote on what comes next and send your ideas.`;
  return {
    title,
    meta: [
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url.href },
    ],
  };
};
