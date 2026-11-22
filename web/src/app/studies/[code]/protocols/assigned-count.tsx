import type { ProtocolVersionSummary } from "@/lib/protocols/queries";

/** Participants assigned to a version now, plus the total ever assigned when it differs. */
export function AssignedCount({ version }: { version: Pick<ProtocolVersionSummary, "currentParticipants" | "totalParticipants"> }) {
  return (
    <>
      {version.currentParticipants} <span className="text-ink-muted">ahora</span>
      {version.totalParticipants !== version.currentParticipants && (
        <span className="block text-xs text-ink-muted">{version.totalParticipants} en total</span>
      )}
    </>
  );
}
