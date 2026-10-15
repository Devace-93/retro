import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

/** Wordmark for retro (emerald speech-bubble mark + "retro") — links home. */
export const Logo = component$<{ href?: string }>(({ href = "/" }) => {
  return (
    <Link href={href} class="flex items-center gap-2 font-bold tracking-tight">
      <span class="grid h-8 w-8 place-items-center rounded-lg bg-primary-600" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {/* speech bubble with three dots */}
          <path d="M4 3.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9.5L6 17v-3.5H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z" fill="#ffffff" fill-opacity="0.92" />
          <circle cx="7" cy="8.5" r="1.1" fill="currentColor" class="text-primary-600" />
          <circle cx="10" cy="8.5" r="1.1" fill="currentColor" class="text-primary-600" />
          <circle cx="13" cy="8.5" r="1.1" fill="currentColor" class="text-primary-600" />
        </svg>
      </span>
      <span class="text-lg text-slate-900">
        <span class="text-primary-600">retro</span>
      </span>
    </Link>
  );
});
