import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { and, db, eq, mediaAssets } from "@observatorio/db";
import { createStorage, type Storage } from "@observatorio/storage";

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

/** Downloads the upload's `video.mp4` from object storage to a temp file (ffmpeg needs a path) and reads `frames.csv`. */
export class StorageSource implements SessionSource {
  constructor(private storage: Storage = createStorage()) {}

  async fetch(uploadId: string) {
    const [video] = await db
      .select({ storageKey: mediaAssets.storageKey })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, uploadId), eq(mediaAssets.kind, "video")));
    if (!video?.storageKey) throw new Error(`upload ${uploadId} has no video in storage`);

    const dir = await mkdtemp(path.join(tmpdir(), "session-"));
    const cleanup = () => rm(dir, { recursive: true, force: true });
    try {
      const videoPath = path.join(dir, "video.mp4");
      await pipeline(await this.storage.getStream(video.storageKey), createWriteStream(videoPath));
      const chunks: Buffer[] = [];
      for await (const chunk of await this.storage.getStream(video.storageKey.replace(/video\.mp4$/, "frames.csv"))) chunks.push(Buffer.from(chunk));
      return { videoPath, framesCsv: Buffer.concat(chunks), cleanup };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}

export function sourceFromEnv(env: NodeJS.ProcessEnv = process.env): SessionSource {
  if (env.LOCAL_MEDIA_DIR) return new LocalDirSource(env.LOCAL_MEDIA_DIR);
  if (env.S3_ENDPOINT) return new StorageSource();
  throw new Error("no media source configured: set S3_* (object storage) or LOCAL_MEDIA_DIR");
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
