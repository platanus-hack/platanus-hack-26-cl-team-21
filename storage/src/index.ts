// S3-compatible object storage shared by web and worker (ADR 0002 §3): Backblaze B2 in production, MinIO locally.
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export * from "./keys";

/** ADR 0002: presigned URLs expire after 1 hour. */
export const DEFAULT_URL_TTL_SECONDS = 3600;

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Host the phone reaches the bucket at, when it differs from `endpoint` (e.g. `http://10.0.2.2:9000` from an Android emulator). Presigned URLs are signed against it. */
  publicEndpoint?: string;
}

export interface ObjectInfo {
  size: number;
  contentType?: string;
  etag?: string;
}

export interface Storage {
  bucket: string;
  /**
   * URL the client PUTs the object to. `contentType` and `contentLength` are signed when given: the PUT must send
   * exactly that `Content-Type` and body size, or the bucket rejects it.
   */
  presignPut(key: string, opts?: { contentType?: string; contentLength?: number; expiresIn?: number }): Promise<string>;
  presignGet(key: string, opts?: { expiresIn?: number }): Promise<string>;
  /** Size and metadata of an object, or `null` if it doesn't exist. */
  head(key: string): Promise<ObjectInfo | null>;
  getStream(key: string): Promise<Readable>;
  /**
   * Permanently deletes every version of the object (B2 keeps old versions and only hides the file on a plain
   * delete, which would leave excluded or purged media in the bucket). Idempotent: a missing key succeeds.
   */
  delete(key: string): Promise<void>;
}

const ENV_VARS = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const missing = ENV_VARS.filter((name) => !env[name]);
  if (missing.length) throw new Error(`storage: missing env vars ${missing.join(", ")}`);
  return {
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION!,
    bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT || undefined,
  };
}

export function createStorage(config: StorageConfig = storageConfigFromEnv()): Storage {
  const { bucket } = config;
  const newClient = (endpoint: string) =>
    new S3Client({
      endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // MinIO on localhost needs path-style URLs; B2 accepts them too.
      forcePathStyle: true,
      // The SDK's default CRC32 checksums would be baked into presigned PUTs (for an empty body) and B2 rejects
      // some of them; integrity is checked with the client's sha256 instead (ADR 0002 §3).
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  const client = newClient(config.endpoint);
  const signer = config.publicEndpoint ? newClient(config.publicEndpoint) : client;

  return {
    bucket,
    presignPut: (key, { contentType, contentLength, expiresIn = DEFAULT_URL_TTL_SECONDS } = {}) =>
      getSignedUrl(
        signer,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
        { expiresIn },
      ),

    presignGet: (key, { expiresIn = DEFAULT_URL_TTL_SECONDS } = {}) =>
      getSignedUrl(signer, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn }),

    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: res.ContentLength ?? 0, contentType: res.ContentType, etag: res.ETag };
      } catch (e) {
        if (e instanceof NotFound || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
          return null;
        throw e;
      }
    },

    async getStream(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      // In Node the SDK returns an IncomingMessage (a Readable).
      return res.Body as Readable;
    },

    async delete(key) {
      const versionIds: string[] = [];
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      do {
        const res = await client.send(
          new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }),
        );
        for (const v of [...(res.Versions ?? []), ...(res.DeleteMarkers ?? [])])
          if (v.Key === key && v.VersionId) versionIds.push(v.VersionId);
        [keyMarker, versionIdMarker] = res.IsTruncated ? [res.NextKeyMarker, res.NextVersionIdMarker] : [undefined, undefined];
      } while (keyMarker);
      for (const versionId of versionIds)
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
    },
  };
}
