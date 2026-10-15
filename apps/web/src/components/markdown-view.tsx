import { component$ } from "@builder.io/qwik";
import { renderMarkdown } from "../lib/markdown";

/** Renders trusted-sanitised Markdown (see lib/markdown.ts) with prose styling. */
export const MarkdownView = component$<{ source: string; class?: string }>(({ source, class: cls }) => {
  return <div class={["prose-retro", cls]} dangerouslySetInnerHTML={renderMarkdown(source)} />;
});
