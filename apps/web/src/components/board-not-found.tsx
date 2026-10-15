import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { tr, useI18n } from "../i18n";

/** Shown by the public board routes when the slug is unknown or the board is disabled. */
export const BoardNotFound = component$(() => {
  const i18n = useI18n();
  return (
    <div class="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 class="text-3xl font-bold text-slate-900">{tr(i18n, "board.notFoundTitle")}</h1>
      <p class="mt-3 text-slate-600">{tr(i18n, "board.notFoundBody")}</p>
      <Link href="/" class="btn-secondary mt-8">
        {tr(i18n, "board.home")}
      </Link>
    </div>
  );
});
