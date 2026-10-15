import { component$ } from "@builder.io/qwik";
import { Link, useLocation } from "@builder.io/qwik-city";
import type { Project } from "../lib/types";
import { tr, useI18n } from "../i18n";
import type { CatalogKey } from "../i18n/catalog/en";

/**
 * Header shared by every project page: back link, name, public-board link
 * and the Inbox / Roadmap / Changelog / Settings tabs.
 */
export const ProjectNav = component$<{ project: Project | null; id: string }>(({ project, id }) => {
  const loc = useLocation();
  const i18n = useI18n();
  const base = `/dashboard/projects/${id}`;
  const path = loc.url.pathname.replace(/\/$/, "");
  const tabs: { href: string; label: CatalogKey; count?: number }[] = [
    { href: base, label: "pnav.inbox", count: project?.counts.new },
    { href: `${base}/roadmap`, label: "pnav.roadmap", count: project?.counts.roadmap },
    { href: `${base}/changelog`, label: "pnav.changelog" },
    { href: `${base}/settings`, label: "pnav.settings" },
  ];
  return (
    <div class="border-b border-slate-200 bg-white">
      <div class="mx-auto max-w-6xl px-4 pt-6">
        <Link href="/dashboard" class="text-sm text-slate-500 hover:text-primary-600">
          {tr(i18n, "pnav.back")}
        </Link>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-bold text-slate-900">{project?.name ?? "…"}</h1>
            {project && <span class="font-mono text-xs text-slate-500">{project.key}</span>}
          </div>
          {project?.board_enabled && project.board_url && (
            <a href={project.board_url} target="_blank" rel="noreferrer" class="btn-secondary text-xs">
              {tr(i18n, "pnav.openBoard")} ↗
            </a>
          )}
        </div>
        <nav class="mt-4 flex gap-1 overflow-x-auto" aria-label={tr(i18n, "pnav.inbox")}>
          {tabs.map((t) => {
            const active = path === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                class={[
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
                  active ? "border-primary-600 text-primary-700" : "border-transparent text-slate-600 hover:text-slate-900",
                ]}
              >
                {tr(i18n, t.label)}
                {t.count !== undefined && t.count > 0 && (
                  <span class="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t.count}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
});
