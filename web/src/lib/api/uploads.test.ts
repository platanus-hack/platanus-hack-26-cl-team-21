import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { coverageIntervals, db, deviceEvents, eq, jobs, mediaAssets, sensorWindowStats } from "@observatorio/db";
import { closeDb, createDevice, createStudyWithParticipant, jsonRequest } from "@/test/fixtures";
import { enroll } from "./enrollments";
import { completeUpload, createUpload, getUpload } from "./uploads";

after(closeDb);

const KINDS = [
  ["video", "video/mp4"],
  ["frames", "text/csv"],
  ["sensors", "text/csv"],
  ["events", "text/csv"],
  ["manifest", "application/json"],
] as const;

async function setup() {
  const { enrollmentCode, participantId } = await createStudyWithParticipant();
  const device = await createDevice();
  const response = await enroll(jsonRequest("http://localhost/api/v1/enrollments", { code: enrollmentCode }));
  const { participant_token: token } = await response.json();
  return { token, participantId, serial: device.serial };
}

const body = (serial: string, overrides: Record<string, unknown> = {}) => ({
  upload_id: randomUUID(),
  device_id: serial,
  firmware_version: "0.1.0",
  device_session_id: `${serial}-1`,
  recorded_from: "2026-11-21T14:00:00-03:00",
  recorded_to: "2026-11-21T15:00:00-03:00",
  files: KINDS.map(([kind, content_type]) => ({ kind, sha256: randomUUID().replaceAll("-", "").repeat(2), bytes: 100, content_type })),
  ...overrides,
});

const post = (token: string | null, payload: unknown) =>
  createUpload(jsonRequest("http://localhost/api/v1/uploads", payload, token ? { authorization: `Bearer ${token}` } : {}));

describe("POST /api/v1/uploads", () => {
  test("creates an upload with a presigned PUT URL per file, then repeats idempotently", async () => {
    const { token, serial } = await setup();
    const payload = body(serial);

    const first = await post(token, payload);
    assert.equal(first.status, 201);
    const created = await first.json();
    assert.equal(created.upload_id, payload.upload_id);
    assert.deepEqual(created.files.map((f: { kind: string }) => f.kind), KINDS.map(([kind]) => kind));
    assert.match(created.files[0].put_url, /^https?:\/\/.+X-Amz-Signature=/);

    assert.equal((await post(token, payload)).status, 200);
    const status = await getUpload(new Request("http://localhost", { headers: { authorization: `Bearer ${token}` } }), payload.upload_id);
    assert.deepEqual(await status.json(), { upload_id: payload.upload_id, status: "awaiting_files" });
  });

  test("rejects the same upload_id with a different body and overlapping ranges", async () => {
    const { token, serial } = await setup();
    const payload = body(serial);
    assert.equal((await post(token, payload)).status, 201);

    const changed = await post(token, { ...payload, firmware_version: "9.9.9" });
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error.code, "upload_conflict");

    const overlapping = await post(token, body(serial, { recorded_from: "2026-11-21T14:30:00-03:00", recorded_to: "2026-11-21T16:00:00-03:00" }));
    assert.equal(overlapping.status, 409);
  });

  test("requires a valid token, a known device and a well-formed body", async () => {
    const { token, serial } = await setup();
    assert.equal((await post(null, body(serial))).status, 401);
    assert.equal((await post(token, body("no-such-device"))).status, 400);
    assert.equal((await post(token, body(serial, { upload_id: "nope" }))).status, 400);
    assert.equal((await post(token, body(serial, { files: [] }))).status, 400);
  });

  test("hides another participant's upload", async () => {
    const owner = await setup();
    const other = await setup();
    const payload = body(owner.serial);
    await post(owner.token, payload);

    const response = await getUpload(new Request("http://localhost", { headers: { authorization: `Bearer ${other.token}` } }), payload.upload_id);
    assert.equal(response.status, 404);
  });
});

describe("POST /api/v1/uploads/{id}/complete", () => {
  const complete = (token: string, id: string, excluded: unknown[] = []) =>
    completeUpload(jsonRequest(`http://localhost/api/v1/uploads/${id}/complete`, { excluded_intervals: excluded }, { authorization: `Bearer ${token}` }), id);

  const T = Date.parse("2026-11-21T14:00:00-03:00");
  const iso = (offsetMs: number) => new Date(T + offsetMs).toISOString();
  const sha = (content: string) => createHash("sha256").update(content).digest("hex");

  // 10 s session: frames 0-2.5 s and 5-6.5 s, 3-5 s excluded by the participant, privacy switch 7-8 s.
  function bundle(serial: string) {
    const excluded = [{ start: iso(3000), end: iso(5000) }];
    const frames = "seq,rtc_epoch_ms,uptime_ms,bytes\n" + [0, 500, 1000, 1500, 2000, 2500, 5000, 5500, 6000, 6500].map((ms, i) => `${i + 1},${T + ms},${ms},100`).join("\n") + "\n";
    const sensors =
      "rtc_epoch,uptime_ms,temp_c,rh_pct,mq7,mq2,sound_p2p,batt_mv\n" +
      Array.from({ length: 10 }, (_, i) => `${T / 1000 + i},${i * 1000},22.5,,300,400,500,${i === 0 ? -1 : 7400}`).join("\n") + "\n";
    const events = `rtc_epoch,uptime_ms,type,value\n${T / 1000},1,BOOT,\n${T / 1000 + 7},7000,PRIVACY_ON,${T / 1000 + 7}\n${T / 1000 + 8},8000,PRIVACY_OFF,${T / 1000 + 8}\n`;
    const video = "not really an mp4 but the server never decodes it " + randomUUID();
    const manifest = JSON.stringify({ manifest_version: "0", excluded_intervals: excluded });
    const contents = { video, frames, sensors, events, manifest };
    const files = KINDS.map(([kind, content_type]) => ({ kind, sha256: sha(contents[kind]), bytes: Buffer.byteLength(contents[kind]), content_type }));
    return { contents, excluded, payload: body(serial, { recorded_from: iso(0), recorded_to: iso(10_000), files }) };
  }

  const putAll = async (files: { kind: string; put_url: string }[], contents: Record<string, string>) => {
    for (const file of files) {
      const put = await fetch(file.put_url, { method: "PUT", headers: { "content-type": KINDS.find(([k]) => k === file.kind)![1] }, body: contents[file.kind] });
      assert.equal(put.status, 200);
    }
  };

  test("rejects missing files", async () => {
    const { token, serial } = await setup();
    const { payload } = bundle(serial);
    await post(token, payload);

    const early = await complete(token, payload.upload_id);
    assert.equal(early.status, 409);
    assert.equal((await early.json()).error.code, "files_missing");
  });

  test("ingests the bundle: media asset, sensors, events, coverage and one job", async () => {
    const { token, serial, participantId } = await setup();
    const { payload, contents, excluded } = bundle(serial);
    const created = await (await post(token, payload)).json();
    await putAll(created.files, contents);

    const [first, second] = await Promise.all([complete(token, payload.upload_id, excluded), complete(token, payload.upload_id, excluded)]);
    assert.equal(first.status, 202);
    const a = await first.json();
    assert.equal(a.status, "processing");
    assert.equal((await second.json()).job_id, a.job_id);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, a.job_id));
    assert.deepEqual(job.payload, { upload_id: payload.upload_id });

    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, payload.upload_id));
    assert.equal(asset.sha256, sha(contents.video));
    assert.equal(asset.recordedFrom.getTime(), T);
    assert.equal(asset.recordedTo.getTime(), T + 6500);

    const coverage = await db.select().from(coverageIntervals).where(eq(coverageIntervals.batchId, payload.upload_id)).orderBy(coverageIntervals.startedAt);
    assert.deepEqual(
      coverage.map((c) => `${c.status}:${c.startedAt.getTime() - T}-${c.endedAt.getTime() - T}`),
      ["observed:0-2500", "device_off:2500-3000", "excluded_by_participant:3000-5000", "observed:5000-6500", "device_off:6500-7000", "privacy_switch:7000-8000", "device_off:8000-10000"],
    );

    const events = await db.select().from(deviceEvents).where(eq(deviceEvents.batchId, payload.upload_id));
    assert.deepEqual(events.map((e) => e.kind).sort(), ["boot", "privacy_switch_off", "privacy_switch_on"]);

    const stats = Object.fromEntries((await sensorWindowStats(participantId, new Date(T), new Date(T + 10_000))).map((s) => [s.sensorType, s]));
    assert.equal(stats.temperature_c.n, 10);
    assert.equal(stats.battery_mv.n, 9); // the first row is -1 (external power)
    assert.equal(stats.humidity_pct, undefined); // every value was empty
  });

  test("rejects a file whose content does not match its declared hash", async () => {
    const { token, serial } = await setup();
    const { payload, contents, excluded } = bundle(serial);
    const created = await (await post(token, payload)).json();
    await putAll(created.files, { ...contents, events: contents.events.replace("BOOT", "BUTT") }); // same size, other content

    const response = await complete(token, payload.upload_id, excluded);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "files_mismatch");
  });

  test("rejects exclusions that differ from the manifest", async () => {
    const { token, serial } = await setup();
    const { payload, contents } = bundle(serial);
    const created = await (await post(token, payload)).json();
    await putAll(created.files, contents);

    const response = await complete(token, payload.upload_id, []);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "files_mismatch");
  });
});
