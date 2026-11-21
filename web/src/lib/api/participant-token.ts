import { createHash, randomBytes } from "node:crypto";
import { db, eq, participants } from "@observatorio/db";
import { ApiError } from "./errors";

const BEARER_PATTERN = /^Bearer (\S+)$/;

export const newParticipantToken = () => randomBytes(32).toString("base64url");

export const hashParticipantToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function authenticateParticipant(request: Request) {
  const token = BEARER_PATTERN.exec(request.headers.get("authorization") ?? "")?.[1];
  if (token) {
    const [participant] = await db
      .select({ participantId: participants.id, studyId: participants.studyId })
      .from(participants)
      .where(eq(participants.tokenSha256, hashParticipantToken(token)));
    if (participant) return participant;
  }
  throw new ApiError(401, "unauthorized", "Missing or invalid participant token");
}
