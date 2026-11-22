import { db, eq, eventTypes, protocolVersions, researchers, sql, studies } from "@observatorio/db";
import type { ProtocolVariable } from "./model";

// Read models for the protocol pages. Callers must `await connection()` first.

// Participants assigned to a version now (assignment valid at this instant) and ever.
const assigned = (onlyCurrent: boolean) => sql<number>`(
  select count(distinct pp.participant_id)::int from participant_protocols pp
  where pp.protocol_version_id = ${protocolVersions.id}
  ${onlyCurrent ? sql`and pp.valid_from <= now() and (pp.valid_to is null or pp.valid_to > now())` : sql``}
)`;

const summaryColumns = {
  id: protocolVersions.id,
  versionLabel: protocolVersions.versionLabel,
  status: protocolVersions.status,
  changeNote: protocolVersions.changeNote,
  parentLabel: sql<string | null>`(select p.version_label from protocol_versions p where p.id = ${protocolVersions.parentVersionId})`,
  publishedBy: researchers.fullName,
  publishedAt: protocolVersions.publishedAt,
  definitionSha256: protocolVersions.definitionSha256,
  createdAt: protocolVersions.createdAt,
  currentParticipants: assigned(true),
  totalParticipants: assigned(false),
};

export type ProtocolVersionSummary = {
  id: string;
  versionLabel: string;
  status: string;
  changeNote: string | null;
  parentLabel: string | null;
  publishedBy: string | null;
  publishedAt: Date | null;
  definitionSha256: string | null;
  createdAt: Date;
  currentParticipants: number;
  totalParticipants: number;
};

function selectSummaries() {
  return db.select(summaryColumns).from(protocolVersions).leftJoin(researchers, eq(researchers.id, protocolVersions.publishedBy));
}

export async function listProtocolVersions(studyId: string): Promise<ProtocolVersionSummary[]> {
  return selectSummaries()
    .where(eq(protocolVersions.studyId, studyId))
    .orderBy(sql`${protocolVersions.createdAt} desc`, protocolVersions.versionLabel);
}

export type ProtocolEventType = { id: string; key: string; label: string; attributesSchema: unknown };

export type ProtocolVersionDetail = ProtocolVersionSummary & {
  definition: Record<string, unknown>;
  eventTypes: ProtocolEventType[];
};

export async function getProtocolVersion(studyId: string, versionLabel: string): Promise<ProtocolVersionDetail | null> {
  const byLabel = sql`${eq(protocolVersions.studyId, studyId)} and ${eq(protocolVersions.versionLabel, versionLabel)}`;
  const [[version], [definitionRow], types] = await Promise.all([
    selectSummaries().where(byLabel),
    db.select({ definition: protocolVersions.definition }).from(protocolVersions).where(byLabel),
    db
      .select({ id: eventTypes.id, key: eventTypes.key, label: eventTypes.label, attributesSchema: eventTypes.attributesSchema })
      .from(eventTypes)
      .innerJoin(protocolVersions, eq(protocolVersions.id, eventTypes.protocolVersionId))
      .where(byLabel),
  ]);
  if (!version) return null;
  const definition = asRecord(definitionRow?.definition);
  // Event types follow the order of definition.event_types (the order the researcher gave them).
  const order = stringList(definition.event_types);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  return {
    ...version,
    definition,
    eventTypes: types.toSorted((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key)),
  };
}

/** No auth yet: changes are attributed to the study creator (the seed researcher), as exports are. */
export async function getActingResearcherId(studyId: string): Promise<string | null> {
  const [row] = await db.select({ createdBy: studies.createdBy }).from(studies).where(eq(studies.id, studyId));
  return row?.createdBy ?? null;
}

// --- Reading a stored definition defensively (older or hand-written rows must not break pages) ---

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The definition's variables, or [] when it has none (e.g. the seeded eating-v1). */
export function readVariables(definition: Record<string, unknown>): ProtocolVariable[] {
  if (!Array.isArray(definition.variables)) return [];
  return definition.variables.flatMap((raw) => {
    const v = asRecord(raw);
    if (typeof v.name !== "string" || typeof v.type !== "string") return [];
    return [
      {
        name: v.name,
        type: v.type as ProtocolVariable["type"],
        ...(typeof v.description === "string" ? { description: v.description } : {}),
        ...(Array.isArray(v.allowed_values) ? { allowed_values: stringList(v.allowed_values) } : {}),
        required: v.required === true,
        applies_to: stringList(v.applies_to),
      },
    ];
  });
}
