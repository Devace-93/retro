import { component$ } from "@builder.io/qwik";
import { Link, routeLoader$, useLocation, type DocumentHead } from "@builder.io/qwik-city";
import { useBoard } from "../layout";
import { BoardNotFound } from "../../../../../components/board-not-found";
import { fetchBoardChangelog } from "../../../../../lib/board.server";
import { fmtDate } from "../../../../../lib/feedback";
import { MarkdownView } from "../../../../../components/markdown-view";
import { tr, useI18n } from "../../../../../i18n";

export const useChangelog = routeLoader$(async ({ params, query }) => {
  const page = Math.max(1, Number(query.get("page") || "1") || 1);
  return (await fetchBoardChangelog(params.slug, page)) ?? { items: [], page, per_page: 20, total: 0 };
});

export default component$(() => {
  const loc = useLocation();
  const result = useBoard();
  const changelog = useChangelog();
  const i18n = useI18n();
  const slug = loc.params.slug;

  if (!result.value.ok) return <BoardNotFound />;
  const board = result.value.board;
  const title = board.project.board_title || board.project.name;
  const data = changelog.value;
  const pages = Math.max(1, Math.ceil(data.total / data.per_page));

  return (
    <div class="mx-auto max-w-3xl px-4 py-12">
      <Link href={`/b/${slug}`} class="text-sm text-slate-500 hover:text-primary-600">
        {tr(i18n, "board.backToRoadmap")}
      </Link>
      <header class="mt-4">
        <p class="text-xs uppercase tracking-wide text-primary-600">{tr(i18n, "board.changelog")}</p>
        <h1 class="mt-1 text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      </header>

      <ol class="mt-8 space-y-6">
        {data.items.length === 0 && <li class="card p-10 text-center text-sm text-slate-500">{tr(i18n, "board.noChangelog")}</li>}
        {data.items.map((e) => (
          <li key={e.id} class="card p-6">
            <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {e.version && <span class="badge bg-primary-100 text-primary-800 font-mono">{e.version}</span>}
              <time dateTime={e.published_at}>{fmtDate(e.published_at, i18n.lang)}</time>
            </div>
            <h2 class="mt-1 text-xl font-semibold text-slate-900">{e.title}</h2>
            <MarkdownView source={e.body} class="mt-3 text-sm" />
          </li>
        ))}
      </ol>

      {pages > 1 && (
        <nav class="mt-8 flex items-center justify-between text-sm">
          {data.page > 1 ? <Link href={`/b/${slug}/changelog?page=${data.page - 1}`} class="btn-secondary">←</Link> : <span />}
          <span class="text-slate-500">{data.page} / {pages}</span>
          {data.page < pages ? <Link href={`/b/${slug}/changelog?page=${data.page + 1}`} class="btn-secondary">→</Link> : <span />}
        </nav>
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
  const title = `${result.board.project.board_title || result.board.project.name} — changelog`;
  return { title, meta: [{ property: "og:title", content: title }, { property: "og:url", content: url.href }] };
};
