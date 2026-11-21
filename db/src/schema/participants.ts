import { sql } from "drizzle-orm";
import { boolean, check, index, pgSchema, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, oneOf, tstz } from "./_shared";
import { protocolVersions } from "./protocols";
import { studies } from "./studies";

export const PARTICIPANT_STATUS = ["enrolled", "active", "withdrawn", "completed"] as const;

// Scientific data only ever points at the pseudonymous participant.
export const participants = pgTable(
  "participants",
  {
    id: id(),
    studyId: uuid().notNull().references(() => studies.id),
    pseudonym: text().notNull(), // 'P-019'
    arm: text(), // study group / arm
    // "Day" in longitudinal tables means the participant's local day, not UTC.
    timezone: text().notNull().default("America/Santiago"),
    status: text({ enum: PARTICIPANT_STATUS }).notNull().default("enrolled"),
    enrolledAt: createdAt(),
    withdrawnAt: tstz(),
  },
  (t) => [unique().on(t.studyId, t.pseudonym), oneOf("participants_status_check", t.status, PARTICIPANT_STATUS)],
);

// Real identity lives in its own schema so it can get its own grants (Ley 21.719): analysts and
// the worker never need to read it.
export const identity = pgSchema("identity");

export const participantIdentities = identity.table("participant_identities", {
  participantId: uuid()
    .primaryKey()
    .references(() => participants.id),
  fullName: text().notNull(),
  email: text(),
  phone: text(),
  nationalIdHash: text(),
  signedConsentStorageKey: text(),
  createdAt: createdAt(),
});

export const consents = pgTable(
  "consents",
  {
    id: id(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    documentVersion: text().notNull(),
    documentSha256: text().notNull(),
    allowsCamera: boolean().notNull(),
    allowsRetentionExtension: boolean().notNull().default(false), // keep video past 7 days while a discrepancy is open
    allowsExternalProcessing: boolean().notNull().default(false), // send frames to a third-party AI provider
    grantedAt: tstz().notNull(),
    revokedAt: tstz(),
  },
  (t) => [
    index().on(t.participantId),
    check("consents_revoked_check", sql`${t.revokedAt} is null or ${t.revokedAt} >= ${t.grantedAt}`),
  ],
);

// Which protocol version each participant ran under. No overlaps (EXCLUDE in custom migration).
export const participantProtocols = pgTable(
  "participant_protocols",
  {
    id: id(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    protocolVersionId: uuid()
      .notNull()
      .references(() => protocolVersions.id),
    validFrom: tstz().notNull(),
    validTo: tstz(), // null = current
  },
  (t) => [check("participant_protocols_range_check", sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`)],
);
