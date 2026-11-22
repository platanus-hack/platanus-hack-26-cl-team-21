import type { ProtocolVersionSummary } from "@/lib/protocols/queries";

/** Participants assigned to a version now, plus the total ever assigned when it differs. */
export function AssignedCount({ version }: { version: Pick<ProtocolVersionSummary, "currentParticipants" | "totalParticipants"> }) {
  return (
    <>
      {version.currentParticipants} <span className="text-zinc-500 dark:text-zinc-400">ahora</span>
      {version.totalParticipants !== version.currentParticipants && (
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{version.totalParticipants} en total</span>
      )}
    </>
  );
}
