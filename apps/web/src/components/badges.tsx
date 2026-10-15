import { component$ } from "@builder.io/qwik";
import {
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  SENTIMENT_ICON,
  SENTIMENT_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  TYPE_ICON,
  TYPE_LABEL,
} from "../lib/feedback";
import type { FeedbackStatus, FeedbackType, Priority, Sentiment } from "../lib/types";
import { tr, useI18n } from "../i18n";

export const TypeBadge = component$<{ type: FeedbackType; compact?: boolean }>(({ type, compact }) => {
  const i18n = useI18n();
  return (
    <span class="badge bg-slate-100 text-slate-700" title={tr(i18n, TYPE_LABEL[type])}>
      <span aria-hidden="true">{TYPE_ICON[type]}</span>
      {!compact && <span class="ml-1">{tr(i18n, TYPE_LABEL[type])}</span>}
    </span>
  );
});

export const StatusBadge = component$<{ status: FeedbackStatus }>(({ status }) => {
  const i18n = useI18n();
  return <span class={["badge", STATUS_CLASS[status]]}>{tr(i18n, STATUS_LABEL[status])}</span>;
});

export const PriorityBadge = component$<{ priority: Priority }>(({ priority }) => {
  const i18n = useI18n();
  if (priority === "none") return null;
  return <span class={["badge", PRIORITY_CLASS[priority]]}>{tr(i18n, PRIORITY_LABEL[priority])}</span>;
});

export const SentimentBadge = component$<{ sentiment?: Sentiment | null }>(({ sentiment }) => {
  const i18n = useI18n();
  if (!sentiment) return null;
  return (
    <span class="badge bg-slate-100 text-slate-700" title={tr(i18n, SENTIMENT_LABEL[sentiment])}>
      <span aria-hidden="true">{SENTIMENT_ICON[sentiment]}</span>
    </span>
  );
});
