import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createMockApi } from "./server.mjs";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".data", `test-${randomUUID()}`);
const processingDelayMs = 50;
let server;
let baseUrl;
let token;

before(async () => {
  server = createMockApi({ dataDir, processingDelayMs });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  token = await enroll("EAT-001-P01");
});

after(async () => {
  server.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function call(method, pathname, { body, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function enroll(code) {
  const { status, body } = await call("POST", "/api/v1/enrollments", { body: { code, device_id: "a1b2c3" } });
  assert.equal(status, 201);
  return body.participant_token;
}

const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const fileContents = { video: "fake-mp4", frames: "t\n1\n", manifest: "{}" };

function uploadBody(uploadId = randomUUID()) {
  return {
    upload_id: uploadId,
    device_id: "a1b2c3",
    firmware_version: "0.1.0",
    device_session_id: "s-0001",
    recorded_from: "2026-11-21T14:00:00-03:00",
    recorded_to: "2026-11-21T14:30:00-03:00",
    files: Object.entries(fileContents).map(([kind, content]) => ({
      kind,
      sha256: sha256(content),
      bytes: Buffer.byteLength(content),
      content_type: "application/octet-stream",
    })),
  };
}

const put = (url, content) => fetch(url, { method: "PUT", body: content });

async function waitForStatus(token, uploadId, status) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await call("GET", `/api/v1/uploads/${uploadId}`, { token });
    if (response.body.status === status) return response;
    await sleep(processingDelayMs / 2);
  }
  assert.fail(`upload never reached ${status}`);
}

test("enrollment returns the participant and study", async () => {
  const { status, body } = await call("POST", "/api/v1/enrollments", { body: { code: "EAT-001-P02" } });
  assert.equal(status, 201);
  assert.equal(body.participant_id, "p-02");
  assert.equal(body.study_id, "study-eating-001");
  assert.equal(body.protocol_version, "eating-v1");
  assert.match(body.participant_token, /^[0-9a-f]{48}$/);
});

test("enrollment errors", async () => {
  const cases = [
    [{ code: "EAT-999-P01" }, 404, "enrollment_code_not_found"],
    [{ code: "toString" }, 404, "enrollment_code_not_found"],
    [{ code: "EAT-001-P00" }, 409, "enrollment_code_used"],
    [{ code: "EAT-001-P01" }, 409, "enrollment_code_used"],
    [{}, 400, "invalid_request"],
  ];
  for (const [body, expectedStatus, expectedCode] of cases) {
    const response = await call("POST", "/api/v1/enrollments", { body });
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    assert.equal(response.body.error.code, expectedCode);
    assert.equal(typeof response.body.error.message, "string");
  }
});

test("full upload goes from awaiting_files to processed", async () => {
  const body = uploadBody();
  const created = await call("POST", "/api/v1/uploads", { token, body });
  assert.equal(created.status, 201);
  assert.equal(created.body.upload_id, body.upload_id);
  assert.deepEqual(created.body.files.map((file) => file.kind), Object.keys(fileContents));
  const videoUrl = new URL(created.body.files[0].put_url);
  assert.equal(videoUrl.pathname, `/storage/uploads/study-eating-001/p-01/${body.upload_id}/video.mp4`);
  assert.ok(Date.parse(created.body.files[0].expires_at) > Date.now());

  assert.equal((await call("GET", `/api/v1/uploads/${body.upload_id}`, { token })).body.status, "awaiting_files");

  for (const file of created.body.files) {
    assert.equal((await put(file.put_url, fileContents[file.kind])).status, 200);
  }

  const completed = await call("POST", `/api/v1/uploads/${body.upload_id}/complete`, {
    token,
    body: { excluded_intervals: [{ start: "2026-11-21T14:10:00-03:00", end: "2026-11-21T14:12:00-03:00" }] },
  });
  assert.equal(completed.status, 202);
  assert.equal(completed.body.status, "processing");
  assert.match(completed.body.job_id, /^[0-9a-f-]{36}$/);

  const processed = await waitForStatus(token, body.upload_id, "processed");
  assert.deepEqual(processed.body, { upload_id: body.upload_id, status: "processed" });
});

test("uploads whose device_session_id starts with fail end as failed", async () => {
  const body = { ...uploadBody(), device_session_id: "fail-0001" };
  const created = await call("POST", "/api/v1/uploads", { token, body });
  for (const file of created.body.files) await put(file.put_url, fileContents[file.kind]);
  const completed = await call("POST", `/api/v1/uploads/${body.upload_id}/complete`, { token });
  assert.equal(completed.status, 202);
  const failed = await waitForStatus(token, body.upload_id, "failed");
  assert.deepEqual(failed.body.error, { code: "processing_failed", message: "Mock processing failure" });
});

test("creating the same upload again returns 200 with fresh URLs", async () => {
  const body = uploadBody();
  const first = await call("POST", "/api/v1/uploads", { token, body });
  const second = await call("POST", "/api/v1/uploads", { token, body });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.notEqual(second.body.files[0].put_url, first.body.files[0].put_url);
  assert.equal((await put(first.body.files[0].put_url, fileContents.video)).status, 403);
  assert.equal((await put(second.body.files[0].put_url, fileContents.video)).status, 200);
});

test("creating an upload with a reused upload_id and a different body returns 409", async () => {
  const body = uploadBody();
  await call("POST", "/api/v1/uploads", { token, body });
  const response = await call("POST", "/api/v1/uploads", { token, body: { ...body, device_session_id: "s-0002" } });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "upload_conflict");
});

test("upload creation validates the body", async () => {
  const cases = [
    { upload_id: "not-a-uuid" },
    { recorded_from: "2026-11-21T14:00:00" },
    { recorded_from: "2026-11-21T15:00:00-03:00" },
    { device_id: "" },
    { files: [] },
    { files: [{ kind: "audio", sha256: "0".repeat(64), bytes: 1, content_type: "audio/wav" }] },
    { files: [{ kind: "video", sha256: "abc", bytes: 1, content_type: "video/mp4" }] },
    { files: [{ kind: "video", sha256: "0".repeat(64), bytes: -1, content_type: "video/mp4" }] },
  ];
  for (const override of cases) {
    const response = await call("POST", "/api/v1/uploads", { token, body: { ...uploadBody(), ...override } });
    assert.equal(response.status, 400, JSON.stringify(override));
    assert.equal(response.body.error.code, "invalid_request");
  }
});

test("calls without a valid token return 401", async () => {
  const uploadId = randomUUID();
  for (const [method, pathname, authToken] of [
    ["POST", "/api/v1/uploads", undefined],
    ["POST", "/api/v1/uploads", "wrong"],
    ["POST", `/api/v1/uploads/${uploadId}/complete`, undefined],
    ["GET", `/api/v1/uploads/${uploadId}`, "wrong"],
  ]) {
    const response = await call(method, pathname, { token: authToken, body: method === "POST" ? uploadBody(uploadId) : undefined });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "unauthorized");
  }
});

test("unknown, malformed or foreign upload ids are rejected", async () => {
  const body = uploadBody();
  await call("POST", "/api/v1/uploads", { token, body });
  const otherToken = await enroll("EAT-001-P03");

  assert.equal((await call("GET", "/api/v1/uploads/nope", { token })).body.error.code, "invalid_request");
  const unknown = await call("GET", `/api/v1/uploads/${randomUUID()}`, { token });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "upload_not_found");
  const foreign = await call("GET", `/api/v1/uploads/${body.upload_id}`, { token: otherToken });
  assert.equal(foreign.status, 404);
  const reusedByOther = await call("POST", "/api/v1/uploads", { token: otherToken, body });
  assert.equal(reusedByOther.status, 409);
});

test("completing with missing or mismatched files returns 409", async () => {
  const body = uploadBody();
  const created = await call("POST", "/api/v1/uploads", { token, body });
  const urls = Object.fromEntries(created.body.files.map((file) => [file.kind, file.put_url]));
  const complete = () => call("POST", `/api/v1/uploads/${body.upload_id}/complete`, { token, body: {} });

  await put(urls.video, fileContents.video);
  const missing = await complete();
  assert.equal(missing.status, 409);
  assert.equal(missing.body.error.code, "files_missing");
  assert.match(missing.body.error.message, /frames, manifest/);

  await put(urls.frames, "wrong size");
  await put(urls.manifest, "[]");
  const mismatched = await complete();
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.body.error.code, "files_mismatch");
  assert.match(mismatched.body.error.message, /frames, manifest/);

  await put(urls.frames, fileContents.frames);
  await put(urls.manifest, fileContents.manifest);
  assert.equal((await complete()).status, 202);
  const repeated = await complete();
  assert.equal(repeated.status, 202);
  assert.equal((await put(urls.video, fileContents.video)).status, 409);
});

test("completion validates excluded intervals", async () => {
  const body = uploadBody();
  await call("POST", "/api/v1/uploads", { token, body });
  for (const excluded_intervals of [
    "nope",
    [{ start: "2026-11-21T14:10:00-03:00" }],
    [{ start: "2026-11-21T14:10:00-03:00", end: "2026-11-21T14:10:00-03:00" }],
  ]) {
    const response = await call("POST", `/api/v1/uploads/${body.upload_id}/complete`, { token, body: { excluded_intervals } });
    assert.equal(response.status, 400, JSON.stringify(excluded_intervals));
    assert.equal(response.body.error.code, "invalid_request");
  }
});

test("PUT URLs reject bad signatures and unknown keys", async () => {
  const body = uploadBody();
  const created = await call("POST", "/api/v1/uploads", { token, body });
  const tampered = new URL(created.body.files[0].put_url);
  tampered.searchParams.set("signature", "0".repeat(32));
  const badSignature = await put(tampered, fileContents.video);
  assert.equal(badSignature.status, 403);
  assert.equal((await badSignature.json()).error.code, "invalid_signature");
  const unknownKey = await put(`${baseUrl}/storage/uploads/x/y/${randomUUID()}/video.mp4`, "x");
  assert.equal(unknownKey.status, 404);
  assert.equal((await unknownKey.json()).error.code, "object_not_found");
});

test("PUT URLs expire", async () => {
  const shortLivedServer = createMockApi({ dataDir, urlTtlSeconds: -1 });
  await new Promise((resolve) => shortLivedServer.listen(0, "127.0.0.1", resolve));
  const shortLivedBaseUrl = `http://127.0.0.1:${shortLivedServer.address().port}`;
  try {
    const enrollment = await fetch(`${shortLivedBaseUrl}/api/v1/enrollments`, { method: "POST", body: JSON.stringify({ code: "EAT-001-P01" }) });
    const { participant_token } = await enrollment.json();
    const created = await fetch(`${shortLivedBaseUrl}/api/v1/uploads`, {
      method: "POST",
      headers: { authorization: `Bearer ${participant_token}` },
      body: JSON.stringify(uploadBody()),
    });
    const { files } = await created.json();
    const expired = await put(files[0].put_url, fileContents.video);
    assert.equal(expired.status, 403);
    assert.equal((await expired.json()).error.code, "url_expired");
  } finally {
    shortLivedServer.close();
  }
});

test("unknown routes and malformed JSON", async () => {
  const unknown = await call("GET", "/api/v1/nothing");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "not_found");
  const malformed = await fetch(`${baseUrl}/api/v1/enrollments`, { method: "POST", body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "invalid_request");
});
