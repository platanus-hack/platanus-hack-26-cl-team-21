import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where process_session gets an upload's files from. Today: a local directory. Once object storage
 * lands, an S3 implementation downloads `video.mp4` to a temp file, reads `frames.csv`, and returns
 * `cleanup` to delete the temp file; nothing else in the pipeline changes.
 */
export interface SessionSource {
  fetch(uploadId: string): Promise<{ videoPath: string; framesCsv: Buffer; cleanup?: () => Promise<void> }>;
}

/** Reads `<root>/<upload_id>/video.mp4` and `<root>/<upload_id>/frames.csv`. */
export class LocalDirSource implements SessionSource {
  constructor(private root: string) {}

  async fetch(uploadId: string) {
    const dir = path.join(this.root, uploadId);
    return { videoPath: path.join(dir, "video.mp4"), framesCsv: await readFile(path.join(dir, "frames.csv")) };
  }
}

export function sourceFromEnv(env: NodeJS.ProcessEnv = process.env): SessionSource {
  if (env.LOCAL_MEDIA_DIR) return new LocalDirSource(env.LOCAL_MEDIA_DIR);
  throw new Error("no media source configured: set LOCAL_MEDIA_DIR (object storage is not wired yet)");
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
