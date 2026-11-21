// Object key layout from ADR 0002 §3.

/** Files of an upload, by contract `kind`. */
export const UPLOAD_FILES = {
  video: "video.mp4",
  frames: "frames.csv",
  sensors: "sensors.csv",
  events: "events.csv",
  manifest: "manifest.json",
} as const;

export type UploadFileKind = keyof typeof UPLOAD_FILES;

// Ids become path segments: reject anything that could escape or split one.
function segment(name: string, value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes(".."))
    throw new Error(`storage: invalid ${name} for an object key: ${JSON.stringify(value)}`);
  return value;
}

/** `uploads/<study_id>/<participant_id>/<upload_id>/` (stored as `sync_batches.raw_storage_key`). */
export function uploadPrefix(studyId: string, participantId: string, uploadId: string): string {
  return `uploads/${segment("study_id", studyId)}/${segment("participant_id", participantId)}/${segment("upload_id", uploadId)}/`;
}

/** `uploads/<study_id>/<participant_id>/<upload_id>/<kind>.<ext>`. */
export function uploadFileKey(studyId: string, participantId: string, uploadId: string, kind: UploadFileKind): string {
  const file = UPLOAD_FILES[kind];
  if (!file) throw new Error(`storage: unknown upload file kind: ${JSON.stringify(kind)}`);
  return uploadPrefix(studyId, participantId, uploadId) + file;
}

/** `clips/<observation_id>.mp4`: one clip per observation, concatenating its evidence cuts. */
export function clipKey(observationId: string): string {
  return `clips/${segment("observation_id", observationId)}.mp4`;
}
