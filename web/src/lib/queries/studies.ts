import { cache } from "react";
import {
  db,
  eq,
  eventTypes,
  participantProtocols,
  participants,
  protocolVersions,
  sql,
  studies,
} from "@observatorio/db";
import { type CoverageBreakdown, type CoverageDayRow, getCoverageByDay, inObservedTime, summarizeCoverage } from "./coverage";

// Read models for the study list and the study overview. Callers must `await connection()` first.

export type StudyListItem = {
  code: string;
  title: string;
  status: string;
  participantCount: number;
};

export async function listStudies(): Promise<StudyListItem[]> {
  return db
    .select({
      code: studies.code,
      title: studies.title,
      status: studies.status,
      participantCount: sql<number>`count(${participants.id})::int`,
    })
    .from(studies)
    .leftJoin(participants, eq(participants.studyId, studies.id))
    .groupBy(studies.id)
    .orderBy(studies.createdAt);
}

export type ProtocolInUse = {
  versionLabel: string;
  status: string;
  publishedAt: Date | null;
  participantCount: number;
};

export type EventTypeColumn = { key: string; label: string };

export type ParticipantOverview = {
  id: string;
  pseudonym: string;
  status: string;
  protocolLabel: string | null;
  /** Event type keys defined by the protocol versions this participant ran under. */
  measuredEventKeys: string[];
  /** Current observations (v_current_observations) in observed time (see inObservedTime), by event type key. */
  observationCounts: Record<string, number>;
  /** Coverage inside the study period (see ./coverage); all zero when the participant has none. */
  coverage: CoverageBreakdown;
  /** Coverage per participant-local day (YYYY-MM-DD), oldest first. */
  days: ({ day: string } & CoverageBreakdown)[];
};

export type StudyOverview = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  protocolsInUse: ProtocolInUse[];
  eventTypes: EventTypeColumn[];
  participants: ParticipantOverview[];
};

export type Study = { id: string; code: string; title: string; description: string | null; status: string };

// The one study-by-code lookup. Memoized per request: the study layout and its pages both call it.
export const getStudyByCode = cache(async (code: string): Promise<Study | null> => {
  const [study] = await db
    .select({ id: studies.id, code: studies.code, title: studies.title, description: studies.description, status: studies.status })
    .from(studies)
    .where(eq(studies.code, code));
  return study ?? null;
});

export async function getStudyOverview(code: string): Promise<StudyOverview | null> {
  const study = await getStudyByCode(code);
  if (!study) return null;

  // Assignment valid now; the no-overlap rule leaves at most one per participant.
  const currentAssignment = sql`${participantProtocols.validFrom} <= now()
    and (${participantProtocols.validTo} is null or ${participantProtocols.validTo} > now())`;

  // Plain tables go through the query builder; the view is raw SQL and coverage comes from the
  // shared study-period helper (./coverage).
  const [protocolsInUse, eventTypeColumns, participantRows, measured, counts, coverage] = await Promise.all([
    db
      .select({
        versionLabel: protocolVersions.versionLabel,
        status: protocolVersions.status,
        publishedAt: protocolVersions.publishedAt,
        participantCount: sql<number>`count(distinct ${participantProtocols.participantId})::int`,
      })
      .from(participantProtocols)
      .innerJoin(participants, eq(participants.id, participantProtocols.participantId))
      .innerJoin(protocolVersions, eq(protocolVersions.id, participantProtocols.protocolVersionId))
      .where(sql`${eq(participants.studyId, study.id)} and ${currentAssignment}`)
      .groupBy(protocolVersions.id)
      .orderBy(sql`${protocolVersions.publishedAt} desc nulls last`),
    // Event types are grouped by key across protocol versions (the key is stable); the label comes
    // from the most recently published version that defines it.
    db
      .selectDistinctOn([eventTypes.key], { key: eventTypes.key, label: eventTypes.label })
      .from(eventTypes)
      .innerJoin(protocolVersions, eq(protocolVersions.id, eventTypes.protocolVersionId))
      .where(sql`${eq(protocolVersions.studyId, study.id)} and ${protocolVersions.status} <> 'draft'`)
      .orderBy(eventTypes.key, sql`${protocolVersions.publishedAt} desc nulls last`),
    db
      .select({
        id: participants.id,
        pseudonym: participants.pseudonym,
        status: participants.status,
        protocolLabel: protocolVersions.versionLabel,
      })
      .from(participants)
      .leftJoin(participantProtocols, sql`${eq(participantProtocols.participantId, participants.id)} and ${currentAssignment}`)
      .leftJoin(protocolVersions, eq(protocolVersions.id, participantProtocols.protocolVersionId))
      .where(eq(participants.studyId, study.id))
      .orderBy(participants.pseudonym),
    db
      .selectDistinct({ participantId: participantProtocols.participantId, key: eventTypes.key })
      .from(participantProtocols)
      .innerJoin(participants, eq(participants.id, participantProtocols.participantId))
      .innerJoin(eventTypes, eq(eventTypes.protocolVersionId, participantProtocols.protocolVersionId))
      .where(eq(participants.studyId, study.id)),
    db.execute<{ participantId: string; key: string; n: number }>(sql`
      select o.participant_id as "participantId", et.key, count(*)::int as n
      from v_current_observations o
      join participants p on p.id = o.participant_id
      join event_types et on et.id = o.event_type_id
      where p.study_id = ${study.id} and ${inObservedTime("o")}
      group by 1, 2`),
    // Coverage per status and participant-local day inside each participant's study period.
    getCoverageByDay(sql`p.study_id = ${study.id}`),
  ]);

  const countsByParticipant = new Map<string, Record<string, number>>();
  for (const row of counts.rows) {
    const entry = countsByParticipant.get(row.participantId) ?? {};
    entry[row.key] = row.n;
    countsByParticipant.set(row.participantId, entry);
  }

  const measuredByParticipant = new Map<string, string[]>();
  for (const row of measured) {
    measuredByParticipant.set(row.participantId, [...(measuredByParticipant.get(row.participantId) ?? []), row.key]);
  }

  // participant id → local day → rows, built in one pass.
  const coverageByParticipant = new Map<string, Map<string, CoverageDayRow[]>>();
  for (const row of coverage) {
    const byDay = coverageByParticipant.get(row.participantId) ?? new Map<string, CoverageDayRow[]>();
    const dayRows = byDay.get(row.day) ?? [];
    dayRows.push(row);
    byDay.set(row.day, dayRows);
    coverageByParticipant.set(row.participantId, byDay);
  }

  return {
    ...study,
    protocolsInUse,
    eventTypes: eventTypeColumns,
    participants: participantRows.map((p) => {
      const byDay = coverageByParticipant.get(p.id) ?? new Map<string, CoverageDayRow[]>();
      const days = [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, dayRows]) => ({ day, ...summarizeCoverage(dayRows) }));
      return {
        ...p,
        measuredEventKeys: measuredByParticipant.get(p.id) ?? [],
        observationCounts: countsByParticipant.get(p.id) ?? {},
        coverage: summarizeCoverage([...byDay.values()].flat()),
        days,
      };
    }),
  };
}
