/**
 * Blog content. Plain data for now (no CMS, no markdown pipeline): a post is a
 * list of sections rendered by routes/(marketing)/blog/[...slug]. Newest first.
 */
export interface PostSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface Post {
  slug: string;
  title: string;
  date: string; // ISO date
  summary: string;
  sections: PostSection[];
}

export const POSTS: Post[] = [
  {
    slug: "what-paid-plans-will-include",
    title: "Launching retro in early access: everything is free for now. Here is what paid plans will include later.",
    date: "2026-10-15",
    summary:
      "retro collects user feedback from your apps — bug reports, praise, complaints and feature requests — through a drop-in widget, a public API or the project's own board, and gives you an inbox, a roadmap and a changelog to close the loop. It is in early access: every account gets the full product at no cost. This post explains what will eventually sit behind paid plans, and what stays free.",
    sections: [
      {
        paragraphs: [
          "retro is the third app in the 3m4 family, after the URL shortener and the feature-flag service. It does one thing: it listens to the people who use your software. Each project gets a public key; drop one script tag in your app and a small button appears where users can report a bug, say what they like or dislike, or propose a feature — with a screenshot if they want. Prefer not to add a widget? Post to the ingest API with curl, fetch or a plain HTML form. Each project can also publish a board where users vote on the roadmap and read the changelog.",
          "Everything lands in a per-project inbox: filter, tag, set a priority, add private notes, promote a request to the roadmap and announce it in the changelog when it ships. People do that from the dashboard, scripts through the REST API with role-scoped keys, and AI agents through the MCP server.",
          "The hosted version at retro.3m4.net is in early access. During early access every account gets the full product: unlimited projects, unlimited feedback, screenshots, boards, the management API and the MCP server. No card, no trial clock.",
        ],
      },
      {
        heading: "What stays free",
        bullets: [
          "Self-hosting. The whole stack is MIT licensed and always will be; a self-hosted instance has no limits beyond the ones you configure.",
          "A free hosted tier with a few projects, a monthly budget of feedback submissions and a sensible amount of screenshot storage.",
          "The widget, the ingest API, public boards with votes, the changelog, notes, tags and priorities.",
          "Basic API access with scoped API keys, and the MCP server for AI agents.",
        ],
      },
      {
        heading: "What will move under paid plans",
        paragraphs: ["The things that cost money to run at scale, or that mostly matter to teams and businesses:"],
        bullets: [
          "Higher counts: more projects, more roadmap items per project and more API keys.",
          "Bigger monthly feedback budgets. Over-budget submissions are still accepted — we never drop a user's feedback — but the dashboard will show the overage.",
          "More screenshot storage. Past the cap, feedback is stored without the image.",
          "Longer audit-log retention (a year or more instead of a rolling week).",
          "Team seats, roles and priority support.",
          "Enterprise: SSO, SLA and custom limits.",
        ],
      },
      {
        heading: "What happens when plans arrive",
        paragraphs: [
          "The widget and the ingest API never stop accepting feedback. Whatever plan you end up on, every public key you shipped keeps working.",
          "We will announce the change here and by email before any limit applies to an existing account, with enough notice to export your data or pick a plan.",
          "The planned tiers are already listed on the pricing page so there are no surprises. Prices and limits there are our current intent, not a contract, and may still change before launch.",
        ],
      },
      {
        heading: "Questions or opinions?",
        paragraphs: [
          "Early access exists to collect them — and yes, retro uses retro: the feedback button on this very site goes to our own inbox. Tell us which of the items above you would pay for, and which you would not; it directly shapes the final plans.",
        ],
      },
    ],
  },
];

export function findPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
