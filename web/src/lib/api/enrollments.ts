import {
  and,
  db,
  deviceAssignments,
  devices,
  eq,
  isNull,
  or,
  participantProtocols,
  participants,
  protocolVersions,
  sql,
} from "@observatorio/db";
import { ApiError, errorResponse, invalidRequest, isNonEmptyString, readJsonObject } from "./errors";
import { hashParticipantToken, newParticipantToken } from "./participant-token";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const NOW = sql`now()`;

export async function enroll(request: Request) {
  try {
    const { code, device_id: deviceSerial } = await readJsonObject(request);
    if (!isNonEmptyString(code)) throw invalidRequest("code is required");
    if (deviceSerial !== undefined && !isNonEmptyString(deviceSerial)) throw invalidRequest("device_id must be a non-empty string");

    const participantToken = newParticipantToken();
    const enrollment = await db.transaction(async (tx) => {
      const participant = await redeemCode(tx, code, hashParticipantToken(participantToken));
      const protocolVersion = await currentProtocolVersion(tx, participant.id);
      if (deviceSerial !== undefined) await assignDevice(tx, participant.id, deviceSerial);
      return { participant_id: participant.id, study_id: participant.studyId, protocol_version: protocolVersion };
    });
    return Response.json({ ...enrollment, participant_token: participantToken }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

// A single conditional UPDATE, so two concurrent requests for the same code can't both redeem it.
async function redeemCode(tx: Tx, code: string, tokenSha256: string) {
  const [redeemed] = await tx
    .update(participants)
    .set({ enrollmentCodeUsedAt: NOW, tokenSha256 })
    .where(and(eq(participants.enrollmentCode, code), isNull(participants.enrollmentCodeUsedAt)))
    .returning({ id: participants.id, studyId: participants.studyId });
  if (redeemed) return redeemed;

  const [existing] = await tx.select({ id: participants.id }).from(participants).where(eq(participants.enrollmentCode, code));
  if (existing) throw new ApiError(409, "enrollment_code_used", "Enrollment code was already used");
  throw new ApiError(404, "enrollment_code_not_found", "Unknown enrollment code");
}

async function currentProtocolVersion(tx: Tx, participantId: string) {
  const [current] = await tx
    .select({ versionLabel: protocolVersions.versionLabel })
    .from(participantProtocols)
    .innerJoin(protocolVersions, eq(protocolVersions.id, participantProtocols.protocolVersionId))
    .where(
      and(
        eq(participantProtocols.participantId, participantId),
        sql`${participantProtocols.validFrom} <= now()`,
        sql`(${participantProtocols.validTo} is null or ${participantProtocols.validTo} > now())`,
      ),
    );
  if (!current) throw new ApiError(500, "internal_error", "Participant has no current protocol");
  return current.versionLabel;
}

// Closes the device's and the participant's open assignments, then opens a new one from now.
async function assignDevice(tx: Tx, participantId: string, deviceSerial: string) {
  const [device] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.serial, deviceSerial))
    .for("no key update");
  if (!device) throw invalidRequest("Unknown device_id");

  const { rows } = await tx.execute<{ timestamp: string }>(sql`select clock_timestamp()::text as timestamp`);
  const assignedAt = sql`${rows[0].timestamp}::timestamptz`;
  await tx
    .update(deviceAssignments)
    .set({ validTo: assignedAt })
    .where(
      and(
        or(eq(deviceAssignments.deviceId, device.id), eq(deviceAssignments.participantId, participantId)),
        isNull(deviceAssignments.validTo),
        sql`${deviceAssignments.validFrom} < ${assignedAt}`,
      ),
    );
  await tx.insert(deviceAssignments).values({ deviceId: device.id, participantId, validFrom: assignedAt });
}
