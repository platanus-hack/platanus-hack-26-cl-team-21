import { label, PROTOCOL_STATUS_LABELS } from "@/lib/labels";

const BADGE_CLASS: Record<string, string> = {
  draft: "bg-amber-100 text-amber-900",
  published: "bg-emerald-100 text-emerald-800",
  retired: "bg-zinc-100 text-ink-muted",
};

export function ProtocolStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE_CLASS[status] ?? BADGE_CLASS.retired}`}>
      {label(PROTOCOL_STATUS_LABELS, status)}
    </span>
  );
}
