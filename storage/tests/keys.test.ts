import assert from "node:assert/strict";
import { test } from "node:test";
import { clipEdlKey, clipKey, uploadFileKey, uploadPrefix } from "../src/keys";

const upload = "6f1c2b9e-3d4a-4f5b-8c7d-9e0f1a2b3c4d";

test("builds upload keys with the ADR layout", () => {
  assert.equal(uploadPrefix("study-eating-001", "p-019", upload), `uploads/study-eating-001/p-019/${upload}/`);
  assert.equal(uploadFileKey("study-eating-001", "p-019", upload, "video"), `uploads/study-eating-001/p-019/${upload}/video.mp4`);
  assert.equal(uploadFileKey("study-eating-001", "p-019", upload, "manifest"), `uploads/study-eating-001/p-019/${upload}/manifest.json`);
});

test("builds clip keys", () => {
  assert.equal(clipKey("42"), "clips/42.mp4");
  assert.equal(clipEdlKey("42"), "clips/42.edl.json");
});

test("rejects ids that would break the layout", () => {
  for (const bad of ["", "..", "a/b", "../x", ".hidden", "a b", "p..1"])
    assert.throws(() => uploadPrefix("study", bad, upload), /invalid participant_id/);
  // @ts-expect-error unknown kind
  assert.throws(() => uploadFileKey("study", "p-1", upload, "audio"), /unknown upload file kind/);
});
