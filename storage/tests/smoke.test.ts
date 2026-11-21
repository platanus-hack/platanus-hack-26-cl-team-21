// Round trip against a real bucket: presign PUT -> upload with fetch -> HEAD -> GET (stream and presigned) -> delete
// (no versions left).
// Needs S3_* (MinIO by default: `docker compose up -d`). Run: npm run storage:test:integration
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { text } from "node:stream/consumers";
import { test } from "node:test";
import { ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { createStorage, storageConfigFromEnv } from "../src/index";

test("presigned PUT, HEAD, GET and delete round trip", async () => {
  const storage = createStorage();
  const key = `smoke-tests/${randomUUID()}.csv`;
  const body = "rtc_epoch,temp_c\n1763740000,23.4\n";
  try {
    const putUrl = await storage.presignPut(key, { contentType: "text/csv", contentLength: Buffer.byteLength(body), expiresIn: 300 });
    const wrongSize = await fetch(putUrl, { method: "PUT", headers: { "Content-Type": "text/csv" }, body: body + "x" });
    assert.equal(wrongSize.status, 403, "the signed size must be enforced");
    assert.equal(await storage.head(key), null);

    const put = await fetch(putUrl, { method: "PUT", headers: { "Content-Type": "text/csv" }, body });
    assert.equal(put.status, 200, await put.text());

    const info = await storage.head(key);
    assert.equal(info?.size, Buffer.byteLength(body));
    assert.equal(info?.contentType, "text/csv");

    assert.equal(await text(await storage.getStream(key)), body);
    const get = await fetch(await storage.presignGet(key, { expiresIn: 300 }));
    assert.equal(await get.text(), body);
  } finally {
    await storage.delete(key);
  }
  assert.equal(await storage.head(key), null);
  assert.deepEqual(await versionsOf(key), [], "delete must leave no versions or hide markers behind");
  await storage.delete(key); // idempotent
});

async function versionsOf(key: string): Promise<string[]> {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = storageConfigFromEnv();
  const client = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  const res = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
  return [...(res.Versions ?? []), ...(res.DeleteMarkers ?? [])].filter((v) => v.Key === key).map((v) => v.VersionId ?? "");
}
