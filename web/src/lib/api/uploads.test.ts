import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { coverageIntervals, db, deviceEvents, deviceSensors, devices, eq, jobs, mediaAssets, sensorWindowStats, syncBatches } from "@observatorio/db";
import { createStorage, uploadFileKey } from "@observatorio/storage";
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
  const { enrollmentCode, participantId, studyId } = await createStudyWithParticipant();
  const device = await createDevice();
  const response = await enroll(jsonRequest("http://localhost/api/v1/enrollments", { code: enrollmentCode }));
  const { participant_token: token } = await response.json();
  return { token, participantId, studyId, serial: device.serial };
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
  const sha = (content: string) => createHash("sha256").update(content).digest("hex");
  const DAY = 24 * 3600_000;

  // 10 s session: frames 0-2.5 s and 5-6.5 s, 3-5 s excluded by the participant, privacy switch 7-8 s.
  // `shift` moves it in time, `withVideo: false` is a whole-clip exclusion (no video or frames), `video` reuses a video.
  function bundle(serial: string, { shift = 0, withVideo = true, video = "not really an mp4 but the server never decodes it " + randomUUID() } = {}) {
    const t0 = T + shift;
    const at = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();
    const id = randomUUID();
    const excluded = [{ start: at(3000), end: at(5000) }];
    const frames = "seq,rtc_epoch_ms,uptime_ms,bytes\n" + [0, 500, 1000, 1500, 2000, 2500, 5000, 5500, 6000, 6500].map((ms, i) => `${i + 1},${t0 + ms},${ms},100`).join("\n") + "\n";
    const sensors =
      "rtc_epoch,uptime_ms,temp_c,rh_pct,mq7,mq2,sound_p2p,batt_mv\n" +
      Array.from({ length: 10 }, (_, i) => `${t0 / 1000 + i},${i * 1000},22.5,,300,400,500,${i === 0 ? -1 : 7400}`).join("\n") + "\n";
    const events = `rtc_epoch,uptime_ms,type,value\n${t0 / 1000},1,BOOT,\n${t0 / 1000 + 7},7000,PRIVACY_ON,${t0 / 1000 + 7}\n${t0 / 1000 + 8},8000,PRIVACY_OFF,${t0 / 1000 + 8}\n`;
    const manifest = JSON.stringify({ manifest_version: "0", upload_id: id, excluded_intervals: excluded });
    const contents: Record<string, string> = { sensors, events, manifest, ...(withVideo ? { video, frames } : {}) };
    const files = KINDS.filter(([kind]) => kind in contents).map(([kind, content_type]) => ({ kind, sha256: sha(contents[kind]), bytes: Buffer.byteLength(contents[kind]), content_type }));
    return { id, video, contents, excluded, payload: body(serial, { upload_id: id, recorded_from: at(0), recorded_to: at(10_000), files }) };
  }

  const putAll = async (files: { kind: string; put_url: string }[], contents: Record<string, string>) => {
    for (const file of files) {
      const put = await fetch(file.put_url, { method: "PUT", headers: { "content-type": KINDS.find(([k]) => k === file.kind)![1] }, body: contents[file.kind] });
      assert.equal(put.status, 200);
    }
  };

  const createAndPut = async (token: string, b: ReturnType<typeof bundle>) => {
    const created = await (await post(token, b.payload)).json();
    await putAll(created.files, b.contents);
    return created;
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
    const b = bundle(serial);
    await createAndPut(token, b);

    const [first, second] = await Promise.all([complete(token, b.id, b.excluded), complete(token, b.id, b.excluded)]);
    assert.equal(first.status, 202);
    const a = await first.json();
    assert.equal(a.status, "processing");
    assert.equal((await second.json()).job_id, a.job_id);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, a.job_id));
    assert.deepEqual(job.payload, { upload_id: b.id });

    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, b.id));
    assert.equal(asset.sha256, sha(b.video));
    assert.equal(asset.recordedFrom.getTime(), T);
    assert.equal(asset.recordedTo.getTime(), T + 6500);

    const coverage = await db.select().from(coverageIntervals).where(eq(coverageIntervals.batchId, b.id)).orderBy(coverageIntervals.startedAt);
    assert.deepEqual(
      coverage.map((c) => `${c.status}:${c.startedAt.getTime() - T}-${c.endedAt.getTime() - T}`),
      ["observed:0-2500", "device_off:2500-3000", "excluded_by_participant:3000-5000", "observed:5000-6500", "device_off:6500-7000", "privacy_switch:7000-8000", "device_off:8000-10000"],
    );

    const events = await db.select().from(deviceEvents).where(eq(deviceEvents.batchId, b.id));
    assert.deepEqual(events.map((e) => e.kind).sort(), ["boot", "privacy_switch_off", "privacy_switch_on"]);

    const stats = Object.fromEntries((await sensorWindowStats(participantId, new Date(T), new Date(T + 10_000))).map((s) => [s.sensorType, s]));
    assert.equal(stats.temperature_c.n, 10);
    assert.equal(stats.battery_mv.n, 9); // the first row is -1 (external power)
    assert.equal(stats.humidity_pct, undefined); // every value was empty
  });

  test("accepts a whole-clip exclusion with no video: no_upload coverage, no media asset", async () => {
    const { token, serial } = await setup();
    const b = bundle(serial, { withVideo: false });
    await createAndPut(token, b);

    const response = await complete(token, b.id, b.excluded);
    assert.equal(response.status, 202);

    assert.equal((await db.select().from(mediaAssets).where(eq(mediaAssets.id, b.id))).length, 0);
    const coverage = await db.select().from(coverageIntervals).where(eq(coverageIntervals.batchId, b.id)).orderBy(coverageIntervals.startedAt);
    assert.deepEqual(
      coverage.map((c) => `${c.status}:${c.startedAt.getTime() - T}-${c.endedAt.getTime() - T}`),
      ["no_upload:0-3000", "excluded_by_participant:3000-5000", "no_upload:5000-7000", "privacy_switch:7000-8000", "no_upload:8000-10000"],
    );
  });

  test("rejects video without frames and a body without sensors", async () => {
    const { token, serial } = await setup();
    const { payload } = bundle(serial);
    const withoutFrames = { ...payload, files: payload.files.filter((f: { kind: string }) => f.kind !== "frames") };
    assert.equal((await post(token, withoutFrames)).status, 400);
    const withoutSensors = { ...payload, files: payload.files.filter((f: { kind: string }) => f.kind !== "sensors") };
    assert.equal((await post(token, withoutSensors)).status, 400);
  });

  test("rejects a file whose content does not match its declared hash", async () => {
    const { token, serial } = await setup();
    const b = bundle(serial);
    const created = await (await post(token, b.payload)).json();
    await putAll(created.files, { ...b.contents, events: b.contents.events.replace("BOOT", "BUTT") }); // same size, other content

    const response = await complete(token, b.id, b.excluded);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "files_mismatch");
  });

  test("rejects exclusions that differ from the manifest", async () => {
    const { token, serial } = await setup();
    const b = bundle(serial);
    await createAndPut(token, b);

    const response = await complete(token, b.id, []);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "files_mismatch");
  });

  test("answers 409 when another upload took the range between create and complete", async () => {
    const { token, serial, participantId } = await setup();
    const b = bundle(serial);
    await createAndPut(token, b);
    // What a concurrent upload of the same participant leaves behind once it completed.
    await db.insert(coverageIntervals).values({ participantId, startedAt: new Date(T + 1000), endedAt: new Date(T + 2000), status: "observed", source: "derived" });

    const response = await complete(token, b.id, b.excluded);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "upload_conflict");
  });

  test("creates a device's sensors once when its first two uploads complete together", async () => {
    const { token, serial } = await setup();
    const [a, b] = [bundle(serial), bundle(serial, { shift: DAY })];
    await Promise.all([createAndPut(token, a), createAndPut(token, b)]);

    const statuses = (await Promise.all([complete(token, a.id, a.excluded), complete(token, b.id, b.excluded)])).map((r) => r.status);
    assert.deepEqual(statuses, [202, 202]);

    const [device] = await db.select({ id: devices.id }).from(devices).where(eq(devices.serial, serial));
    const sensors = await db.select().from(deviceSensors).where(eq(deviceSensors.deviceId, device.id));
    assert.deepEqual(sensors.map((s) => s.sensorTypeKey).sort(), ["battery_mv", "co_raw", "flammable_gas_raw", "sound_level_raw", "temperature_c"]);
  });

  test("a retry of a failed upload replaces it: its rows and objects go, the new one lands", async () => {
    const { token, serial, studyId, participantId } = await setup();
    const failed = bundle(serial);
    await createAndPut(token, failed);
    assert.equal((await complete(token, failed.id, failed.excluded)).status, 202);
    await db.update(syncBatches).set({ status: "failed", errorCode: "processing_failed", errorMessage: "boom" }).where(eq(syncBatches.id, failed.id));

    // Same session, range and video, new upload_id (the manifest carries it, so its hash differs).
    const retry = bundle(serial, { video: failed.video });
    const created = await post(token, retry.payload);
    assert.equal(created.status, 201);

    assert.equal((await db.select().from(coverageIntervals).where(eq(coverageIntervals.batchId, failed.id))).length, 0);
    assert.equal((await db.select().from(deviceEvents).where(eq(deviceEvents.batchId, failed.id))).length, 0);
    assert.equal((await db.select().from(mediaAssets).where(eq(mediaAssets.id, failed.id))).length, 0);
    const [kept] = await db.select().from(syncBatches).where(eq(syncBatches.id, failed.id));
    assert.equal(kept.status, "failed");
    const storage = createStorage();
    for (const kind of ["video", "frames", "sensors", "events", "manifest"] as const) {
      assert.equal(await storage.head(uploadFileKey(studyId, participantId, failed.id, kind)), null);
    }

    await putAll((await created.json()).files, retry.contents);
    assert.equal((await complete(token, retry.id, retry.excluded)).status, 202);
    assert.equal((await db.select().from(mediaAssets).where(eq(mediaAssets.id, retry.id))).length, 1);
  });

  test("hands out presigned URLs that expire in 15 minutes", async () => {
    const { token, serial } = await setup();
    const created = await (await post(token, bundle(serial).payload)).json();
    const minutes = (Date.parse(created.files[0].expires_at) - Date.now()) / 60_000;
    assert.ok(minutes > 14 && minutes <= 15, `expires in ${minutes} min`);
    assert.match(created.files[0].put_url, /X-Amz-Expires=900/);
  });
});
