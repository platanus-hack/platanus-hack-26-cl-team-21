import { label, PROTOCOL_STATUS_LABELS } from "@/lib/labels";

const BADGE_CLASS: Record<string, string> = {
  draft: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  retired: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function ProtocolStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE_CLASS[status] ?? BADGE_CLASS.retired}`}>
      {label(PROTOCOL_STATUS_LABELS, status)}
    </span>
  );
}
