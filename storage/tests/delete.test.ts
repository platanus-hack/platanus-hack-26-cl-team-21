import assert from "node:assert/strict";
import { test } from "node:test";
import { DeleteObjectCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { createStorage } from "../src/index";

const config = { endpoint: "http://s3.test", region: "us-east-1", bucket: "b", accessKeyId: "a", secretAccessKey: "s" };

test("delete removes every version and hide marker of the exact key, across pages", async (t) => {
  const pages = [
    {
      IsTruncated: true,
      NextKeyMarker: "clips/4.mp4",
      NextVersionIdMarker: "v2",
      Versions: [{ Key: "clips/4.mp4", VersionId: "v1" }, { Key: "clips/4.mp4", VersionId: "v2" }],
    },
    {
      IsTruncated: false,
      Versions: [{ Key: "clips/4.mp4.bak", VersionId: "other" }],
      DeleteMarkers: [{ Key: "clips/4.mp4", VersionId: "m1" }],
    },
  ];
  const listed: unknown[] = [];
  const deleted: unknown[] = [];
  t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
    if (command instanceof ListObjectVersionsCommand) {
      listed.push(command.input);
      return pages[listed.length - 1];
    }
    if (command instanceof DeleteObjectCommand) return void deleted.push(command.input);
    throw new Error("unexpected command");
  });

  await createStorage(config).delete("clips/4.mp4");

  assert.deepEqual(listed, [
    { Bucket: "b", Prefix: "clips/4.mp4", KeyMarker: undefined, VersionIdMarker: undefined },
    { Bucket: "b", Prefix: "clips/4.mp4", KeyMarker: "clips/4.mp4", VersionIdMarker: "v2" },
  ]);
  assert.deepEqual(
    deleted,
    ["v1", "v2", "m1"].map((VersionId) => ({ Bucket: "b", Key: "clips/4.mp4", VersionId })),
  );
});

test("delete of a missing key sends no deletes", async (t) => {
  const send = t.mock.method(S3Client.prototype, "send", async () => ({ IsTruncated: false }));
  await createStorage(config).delete("clips/missing.mp4");
  assert.equal(send.mock.callCount(), 1);
});

