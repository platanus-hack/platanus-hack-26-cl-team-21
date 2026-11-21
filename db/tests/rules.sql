-- Regression tests for the database rules (CHECKs, EXCLUDE constraints, triggers, SQL functions).
-- Run with `npm run db:test`: the runner wraps this file in a transaction and rolls it back, so it
-- is safe against a dev database that already has data. Each check appends 'ok …' or 'FAIL …' to
-- the temp table `results`.

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_pattern text, p_label text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'FAIL  ' || p_label || ' (no error)';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM ~* p_pattern THEN RETURN 'ok    ' || p_label; END IF;
  RETURN 'FAIL  ' || p_label || ' -> ' || SQLERRM;
END $$;
CREATE FUNCTION pg_temp.expect(p_cond boolean, p_label text) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN p_cond THEN 'ok    ' ELSE 'FAIL  ' END || p_label $$;
CREATE TEMP TABLE results (n serial, r text);

-- ---------- seed ----------
INSERT INTO researchers (id, email, full_name) VALUES ('00000000-0000-0000-0000-000000000001', 'rules-test@example.org', 'Rules test');
INSERT INTO studies (id, code, title, created_by) VALUES ('00000000-0000-0000-0000-0000000000a1', 'RULES-TEST', 'Rules test', '00000000-0000-0000-0000-000000000001');
INSERT INTO protocol_versions (id, study_id, version_label, definition)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'v1', '{"sensors":{}}');
INSERT INTO event_types (id, protocol_version_id, key, label) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'meal', 'Comida'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b1', 'exercise', 'Ejercicio');
INSERT INTO capture_windows (id, protocol_version_id, days_of_week, start_time, end_time)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '{1,2,3,4,5}', '12:00', '14:00');
UPDATE protocol_versions SET status = 'published', published_at = now(), definition_sha256 = 'abc'
WHERE id = '00000000-0000-0000-0000-0000000000b1';

-- ---------- protocol immutability ----------
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE protocol_versions SET definition = '{"x":1}' WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'publish a new version', 'published protocol cannot be edited');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE protocol_versions SET status = 'draft' WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'publish a new version', 'published protocol cannot go back to draft');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$DELETE FROM protocol_versions WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'cannot be deleted', 'published protocol cannot be deleted');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO event_types (protocol_version_id, key, label) VALUES ('00000000-0000-0000-0000-0000000000b1','sleep','Sueno')$q$, 'immutable', 'no event types added to a published protocol');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE capture_windows SET end_time = '15:00' WHERE id = '00000000-0000-0000-0000-0000000000c1'$q$, 'immutable', 'capture windows of a published protocol are frozen');
UPDATE protocol_versions SET status = 'retired' WHERE id = '00000000-0000-0000-0000-0000000000b1';
INSERT INTO results (r) SELECT pg_temp.expect((SELECT status = 'retired' FROM protocol_versions WHERE id = '00000000-0000-0000-0000-0000000000b1'), 'published -> retired is allowed');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE protocol_versions SET published_at = now() - interval '1 day' WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'publish a new version', 'publication metadata is frozen too');
INSERT INTO protocol_versions (id, study_id, version_label, parent_version_id, definition)
VALUES ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000a1', 'v2-draft', '00000000-0000-0000-0000-0000000000b1', '{"sensors":{}}');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE protocol_versions SET status = 'published' WHERE id = '00000000-0000-0000-0000-0000000000b9'$q$, 'protocol_versions_published_check', 'published requires published_at + sha');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO pipeline_runs (protocol_version_id, trigger, model_provider, model_name, model_version, pipeline_version, status) VALUES ('00000000-0000-0000-0000-0000000000b9','upload','test','vlm','1','0.1.0','queued')$q$, 'is a draft', 'pipeline runs cannot use a draft protocol');

-- ---------- participants / devices ----------
INSERT INTO participants (id, study_id, pseudonym) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'P-001'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', 'P-002');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO participants (study_id, pseudonym) VALUES ('00000000-0000-0000-0000-0000000000a1','P-001')$q$, 'duplicate key', 'pseudonym unique per study');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE participants SET timezone = 'Santiago' WHERE id = '00000000-0000-0000-0000-0000000000f2'$q$, 'time zone', 'unknown participant time zone rejected');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO participant_protocols (participant_id, protocol_version_id, valid_from) VALUES ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000b9',now())$q$, 'is a draft', 'participants cannot be assigned a draft protocol');
INSERT INTO devices (id, serial, hardware_revision, form_factor) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'RULES-TEST-1', 'r1', 'pendant'),
  ('00000000-0000-0000-0000-0000000000d2', 'RULES-TEST-2', 'r1', 'clip');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO devices (serial, hardware_revision, form_factor) VALUES ('RULES-TEST-X','r1','watch')$q$, 'devices_form_factor_check', 'form factor outside the vocabulary');
INSERT INTO device_assignments (device_id, participant_id, valid_from, valid_to) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '2026-11-01', '2026-11-15');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO device_assignments (device_id, participant_id, valid_from) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000f2','2026-11-10')$q$, 'device_no_overlap', 'a device is never with two participants at once');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO device_assignments (device_id, participant_id, valid_from) VALUES ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000f1','2026-11-14')$q$, 'participant_no_overlap', 'a participant never has two devices at once');
INSERT INTO device_assignments (device_id, participant_id, valid_from) VALUES
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f1', '2026-11-15');
INSERT INTO results (r) SELECT pg_temp.expect(true, 'back-to-back device swap is allowed');

-- ---------- coverage ----------
INSERT INTO coverage_intervals (participant_id, started_at, ended_at, status, source) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '2026-11-20 08:00-03', '2026-11-20 12:00-03', 'observed', 'device'),
  ('00000000-0000-0000-0000-0000000000f1', '2026-11-20 12:00-03', '2026-11-20 12:30-03', 'excluded_by_participant', 'app');
INSERT INTO results (r) SELECT pg_temp.expect(true, 'back-to-back coverage intervals are allowed');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO coverage_intervals (participant_id, started_at, ended_at, status, source) VALUES ('00000000-0000-0000-0000-0000000000f1','2026-11-20 11:00-03','2026-11-20 13:00-03','device_off','derived')$q$, 'coverage_intervals_no_overlap', 'one coverage status per instant');

-- ---------- sensors ----------
INSERT INTO sensor_types (key, unit) VALUES ('sound_level_raw', 'raw'), ('temperature_c', 'C') ON CONFLICT DO NOTHING;
INSERT INTO device_sensors (id, device_id, sensor_type_key, component_model, installed_at) VALUES
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000d2', 'sound_level_raw', 'KY-037', '2026-11-01'),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-0000000000d2', 'temperature_c', 'DHT11', '2026-11-01');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO sensor_series (participant_id, device_sensor_id, period_s) VALUES ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-000000000051',7)$q$, 'sensor_series_period_check', 'period must divide 3600');
INSERT INTO sensor_series (participant_id, device_sensor_id, period_s) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000051', 10),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000052', 60);
CREATE TEMP TABLE s AS
SELECT (SELECT id FROM sensor_series WHERE device_sensor_id = '00000000-0000-0000-0000-000000000051') AS sound,
       (SELECT id FROM sensor_series WHERE device_sensor_id = '00000000-0000-0000-0000-000000000052') AS temp;

-- jittered timestamps around an hour boundary: 13:59:54.9 snaps to 13:59:50, 13:59:56 to 14:00:00
INSERT INTO results (r) SELECT pg_temp.expect(
  ingest_sensor_readings((SELECT sound FROM s),
    ARRAY['2026-11-20 13:59:50.2-03', '2026-11-20 13:59:54.9-03', '2026-11-20 13:59:56-03', '2026-11-20 14:00:10.4-03']::timestamptz[],
    ARRAY[50, 51, 60, 61]::real[]) = 4,
  'ingest returns readings written');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT c.vals[360] = 51 AND h.n = 1 FROM sensor_chunks c JOIN sensor_hourly h ON h.series_id = c.series_id AND h.hour = c.chunk_start
   WHERE c.series_id = (SELECT sound FROM s) AND c.chunk_start = '2026-11-20 13:00-03'),
  'snaps to nearest slot; last value in a slot wins');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT c.vals[1] = 60 AND c.vals[2] = 61 AND h.n = 2 AND h.v_min = 60 AND h.v_max = 61
   FROM sensor_chunks c JOIN sensor_hourly h ON h.series_id = c.series_id AND h.hour = c.chunk_start
   WHERE c.series_id = (SELECT sound FROM s) AND c.chunk_start = '2026-11-20 14:00-03'),
  '13:59:56 lands in slot 0 of 14:00; hourly stats match');
SELECT ingest_sensor_readings((SELECT sound FROM s), ARRAY['2026-11-20 14:00:10-03']::timestamptz[], ARRAY[61]::real[]);
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT count(*) = 2 AND sum(n) = 3 FROM sensor_hourly WHERE series_id = (SELECT sound FROM s)), 're-sending a batch is idempotent');
SELECT ingest_sensor_readings((SELECT sound FROM s), ARRAY['2026-11-20 14:00:10-03', '2026-11-20 14:00:20-03', '2026-11-20 14:00:30-03']::timestamptz[], ARRAY[NULL, 'NaN', 'Infinity']::real[]);
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT c.vals[2] = 61 AND c.vals[3] IS NULL AND h.n = 2 AND h.v_max = 61
   FROM sensor_chunks c JOIN sensor_hourly h ON h.series_id = c.series_id AND h.hour = c.chunk_start
   WHERE c.series_id = (SELECT sound FROM s) AND c.chunk_start = '2026-11-20 14:00-03'),
  'NULL / non-finite values are skipped: no erased reading, no NaN stats');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE sensor_series SET period_s = 30 WHERE id = (SELECT sound FROM s)$q$, 'immutable', 'series period cannot change once created');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$SELECT ingest_sensor_readings(1, ARRAY[now()], ARRAY[1,2]::real[])$q$, 'timestamps but', 'mismatched array lengths rejected');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$SELECT ingest_sensor_readings(-1, ARRAY[now()], ARRAY[1]::real[])$q$, 'does not exist', 'unknown series rejected');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO sensor_chunks (series_id, chunk_start, period_s, vals) SELECT sound, '2026-11-20 10:30-03', 10, array_fill(NULL::real, ARRAY[360]) FROM s$q$, 'sensor_chunks_hour_check', 'chunks start on a UTC hour');

-- window stats (EMA context)
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT n = 3 AND abs(mean - (51+60+61)/3.0) < 1e-6
   FROM sensor_window_stats('00000000-0000-0000-0000-0000000000f1', '2026-11-20 13:55-03', '2026-11-20 14:05-03') WHERE sensor_type = 'sound_level_raw'),
  'sensor_window_stats over +-5 min across an hour boundary');

-- daily stats with DST: Chile springs forward on 2026-09-06 (23 h local day)
SELECT ingest_sensor_readings((SELECT temp FROM s),
  ARRAY(SELECT generate_series('2026-09-06 00:00'::timestamp AT TIME ZONE 'America/Santiago',
                               '2026-09-07 00:00'::timestamp AT TIME ZONE 'America/Santiago' - interval '1 min', interval '1 min')),
  ARRAY(SELECT 20::real FROM generate_series(1, 23*60)));
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT expected = 1380 AND n = 1380 AND coverage = 1
   FROM sensor_daily('00000000-0000-0000-0000-0000000000a1', '2026-09-06', '2026-09-06') WHERE sensor_type = 'temperature_c'),
  'sensor_daily: DST day has 23 h and 100% coverage');

-- device swap mid-day: 12 h of a 60 s series + 12 h of a 30 s series still cover the whole day
INSERT INTO device_sensors (id, device_id, sensor_type_key, component_model, installed_at)
VALUES ('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-0000000000d1', 'temperature_c', 'DHT11', '2026-10-01');
INSERT INTO sensor_series (participant_id, device_sensor_id, period_s)
VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000053', 30);
SELECT ingest_sensor_readings((SELECT temp FROM s),
  ARRAY(SELECT generate_series('2026-10-10 00:00'::timestamp AT TIME ZONE 'America/Santiago',
                               '2026-10-10 12:00'::timestamp AT TIME ZONE 'America/Santiago' - interval '1 min', interval '1 min')),
  ARRAY(SELECT 20::real FROM generate_series(1, 12*60)));
SELECT ingest_sensor_readings((SELECT id FROM sensor_series WHERE device_sensor_id = '00000000-0000-0000-0000-000000000053'),
  ARRAY(SELECT generate_series('2026-10-10 12:00'::timestamp AT TIME ZONE 'America/Santiago',
                               '2026-10-11 00:00'::timestamp AT TIME ZONE 'America/Santiago' - interval '30 s', interval '30 s')),
  ARRAY(SELECT 22::real FROM generate_series(1, 24*60)));
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT n = 2160 AND abs(coverage - 1) < 1e-9
   FROM sensor_daily('00000000-0000-0000-0000-0000000000a1', '2026-10-10', '2026-10-10') WHERE sensor_type = 'temperature_c'),
  'sensor_daily: coverage adds up series with different periods');

-- session timezone must not shift chunk boundaries
SET LOCAL TIME ZONE 'Asia/Kolkata';
SELECT ingest_sensor_readings((SELECT sound FROM s),
  ARRAY['2026-11-21 10:00:00+00', '2026-11-21 10:31:00+00']::timestamptz[], ARRAY[1, 2]::real[]);
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT count(*) = 1 AND min(n) = 2 FROM sensor_hourly WHERE series_id = (SELECT sound FROM s) AND hour = '2026-11-21 10:00:00+00'),
  'a +05:30 session still writes UTC hours');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT n = 1 FROM sensor_window_stats('00000000-0000-0000-0000-0000000000f1', '2026-11-21 10:30:00+00', '2026-11-21 10:35:00+00') WHERE sensor_type = 'sound_level_raw'),
  'sensor_window_stats in a +05:30 session');
SET LOCAL TIME ZONE 'UTC';

-- ---------- capture & media ----------
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO capture_prompts (participant_id, capture_window_id, scheduled_for, outcome) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000c1',now(),'manual')$q$, 'capture_prompts_manual_check', 'manual capture has no window');
INSERT INTO media_assets (id, participant_id, device_id, firmware_version, kind, recorded_from, recorded_to, sha256, size_bytes, storage_key, base_retain_until)
VALUES ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d2', 'fw-1.0', 'video',
        '2026-11-20 13:00-03', '2026-11-20 13:01-03', 'rules-test-sha-1', 1000, 's3://x/1', now() + interval '7 days');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE media_assets SET status = 'deleted' WHERE id = '00000000-0000-0000-0000-000000000071'$q$, 'tombstone_check', 'deleting requires storage_key NULL + deleted_at');
UPDATE media_assets SET status = 'deleted', storage_key = NULL, deleted_at = now(), deletion_reason = 'retention_expired'
WHERE id = '00000000-0000-0000-0000-000000000071';
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT sha256 = 'rules-test-sha-1' AND storage_key IS NULL FROM media_assets WHERE id = '00000000-0000-0000-0000-000000000071'),
  'tombstone keeps hash after the file is gone');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO media_assets (id, participant_id, device_id, firmware_version, kind, recorded_from, recorded_to, sha256, size_bytes, storage_key, base_retain_until) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000d2','fw-1.0','video',now(),now(),'rules-test-sha-1',1,'s3://dup',now())$q$, 'duplicate key', 'same file hash is never uploaded twice');

-- ---------- self-report, discrepancies, retention ----------
INSERT INTO media_assets (id, participant_id, device_id, firmware_version, kind, recorded_from, recorded_to, sha256, size_bytes, storage_key, base_retain_until)
VALUES ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d2', 'fw-1.0', 'video',
        '2026-11-20 13:00-03', '2026-11-20 13:01-03', 'rules-test-sha-2', 1000, 's3://x/2', now() + interval '7 days');
INSERT INTO activity_reports (id, participant_id, event_type_id, started_at, ended_at, reported_at, channel)
VALUES ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1',
        '2026-11-20 13:00-03', '2026-11-20 13:30-03', '2026-11-20 18:00-03', 'app');
INSERT INTO discrepancies (id, participant_id, kind, activity_report_id, detector_version)
VALUES ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-0000000000f1', 'reported_not_detected', '00000000-0000-0000-0000-000000000081', 'det-v1');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO discrepancies (participant_id, kind, activity_report_id, detector_version) VALUES ('00000000-0000-0000-0000-0000000000f1','reported_not_detected','00000000-0000-0000-0000-000000000081','det-v2')$q$, 'discrepancies_pair_unique', 'detector is idempotent (NULLS NOT DISTINCT)');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE discrepancies SET status = 'resolved' WHERE id = '00000000-0000-0000-0000-000000000091'$q$, 'discrepancies_resolved_check', 'resolving requires a resolution');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO retention_holds (media_asset_id, reason, expires_at) VALUES ('00000000-0000-0000-0000-000000000072','discrepancy',now())$q$, 'retention_holds_discrepancy_check', 'discrepancy hold requires discrepancy_id');
INSERT INTO retention_holds (media_asset_id, reason, discrepancy_id, expires_at)
VALUES ('00000000-0000-0000-0000-000000000072', 'discrepancy', '00000000-0000-0000-0000-000000000091', now() + interval '14 days');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT retain_until > now() + interval '13 days' FROM v_media_retention WHERE id = '00000000-0000-0000-0000-000000000072'),
  'active hold extends effective retention');
UPDATE retention_holds SET released_at = now() WHERE media_asset_id = '00000000-0000-0000-0000-000000000072';
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT retain_until < now() + interval '8 days' FROM v_media_retention WHERE id = '00000000-0000-0000-0000-000000000072'),
  'released hold falls back to base retention');
INSERT INTO retention_holds (media_asset_id, reason, discrepancy_id, expires_at)
VALUES ('00000000-0000-0000-0000-000000000072', 'discrepancy', '00000000-0000-0000-0000-000000000091', now() + interval '1 year');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT v.retain_until = m.base_retain_until + interval '14 days'
   FROM v_media_retention v JOIN media_assets m ON m.id = v.id WHERE v.id = '00000000-0000-0000-0000-000000000072'),
  'a hold never extends retention past studies.max_hold_days');

-- ---------- observations, evidence, reviews ----------
INSERT INTO pipeline_runs (id, protocol_version_id, trigger, model_provider, model_name, model_version, pipeline_version, status)
VALUES ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 'upload', 'test', 'vlm', '1', '0.1.0', 'succeeded'),
       ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', 'reprocess', 'test', 'vlm', '2', '0.1.1', 'succeeded');
INSERT INTO observations (id, participant_id, pipeline_run_id, event_type_id, started_at, ended_at, attributes, confidence) VALUES
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1',
   '2026-11-20 13:00-03', '2026-11-20 13:20-03', '{"episode_kind":"meal"}', 0.8),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1',
   '2026-11-20 16:00-03', '2026-11-20 16:05-03', '{"episode_kind":"snack"}', 0.6),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2',
   '2026-11-20 18:00-03', '2026-11-20 18:30-03', '{}', 0.7);
INSERT INTO observation_evidence (observation_id, media_asset_id, start_second, end_second) VALUES
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000071', 0, 30),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000072', 5, 45);
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT count(*) = 2 FROM observation_evidence WHERE observation_id = '00000000-0000-0000-0000-0000000000b2'),
  'one observation can cite several evidence clips (one of them already a tombstone)');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO observation_evidence (observation_id, media_asset_id, start_second, end_second) VALUES ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000072',40,10)$q$, 'observation_evidence_range_check', 'evidence cut must have end > start');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT human_review_status = 'pending' FROM v_current_observations WHERE id = '00000000-0000-0000-0000-0000000000b2'),
  'unreviewed observation is pending');
INSERT INTO observation_reviews (observation_id, reviewer_id, decision, corrected_attributes, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'confirmed', NULL, now() - interval '1 minute'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'corrected', '{"episode_kind":"snack"}', now()),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000001', 'rejected', NULL, now());
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT human_review_status = 'corrected' AND attributes->>'episode_kind' = 'snack' FROM v_current_observations WHERE id = '00000000-0000-0000-0000-0000000000b2'),
  'latest review wins and its correction is applied');
INSERT INTO observation_reviews (observation_id, reviewer_id, decision, corrected_attributes) VALUES
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000001', 'corrected', '{"x":1}');
INSERT INTO observation_reviews (observation_id, reviewer_id, decision) VALUES
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000001', 'confirmed');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT human_review_status = 'confirmed' FROM v_current_observations WHERE id = '00000000-0000-0000-0000-0000000000b4'),
  'two reviews in one transaction: the later one wins');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE observation_reviews SET decision = 'rejected' WHERE observation_id = '00000000-0000-0000-0000-0000000000b4'$q$, 'append-only', 'reviews cannot be edited');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE observations SET attributes = '{"episode_kind":"drink"}' WHERE id = '00000000-0000-0000-0000-0000000000b2'$q$, 'append-only', 'observations cannot be edited in place');
INSERT INTO results (r) SELECT pg_temp.expect(
  NOT EXISTS (SELECT 1 FROM v_current_observations WHERE id = '00000000-0000-0000-0000-0000000000b3'),
  'rejected observation is hidden from current observations');
UPDATE observations SET superseded_by_run_id = '00000000-0000-0000-0000-0000000000a3' WHERE id = '00000000-0000-0000-0000-0000000000b4';
INSERT INTO results (r) SELECT pg_temp.expect(
  NOT EXISTS (SELECT 1 FROM v_current_observations WHERE id = '00000000-0000-0000-0000-0000000000b4')
  AND EXISTS (SELECT 1 FROM observations WHERE id = '00000000-0000-0000-0000-0000000000b4'),
  'superseded observation is kept but hidden from current observations');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE observations SET superseded_by_run_id = '00000000-0000-0000-0000-0000000000a2' WHERE id = '00000000-0000-0000-0000-0000000000b4'$q$, 'append-only', 'a superseded observation stays superseded by the same run');

-- ---------- device events ----------
INSERT INTO device_events (id, device_id, occurred_at, kind, firmware_version)
VALUES ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000d2', '2026-11-20 12:00-03', 'privacy_switch_on', 'fw-1.0');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO device_events (id, device_id, occurred_at, kind, firmware_version) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000d2',now(),'mood_change','fw-1.0')$q$, 'device_events_kind_check', 'device event kind outside the vocabulary');
INSERT INTO device_events (id, device_id, occurred_at, kind, firmware_version)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000d2', '2026-11-20 12:05-03', kind, 'fw-1.0'
FROM unnest(ARRAY['boot', 'rtc_set', 'rtc_lost', 'camera_boot']) AS kind;
INSERT INTO results (r) SELECT pg_temp.expect(true, 'firmware event kinds (boot, rtc_set, rtc_lost, camera_boot) are accepted');

-- ---------- enrollment ----------
UPDATE participants SET enrollment_code = 'RULES-TEST-P01' WHERE id = '00000000-0000-0000-0000-0000000000f1';
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE participants SET enrollment_code = 'RULES-TEST-P01' WHERE id = '00000000-0000-0000-0000-0000000000f2'$q$, 'duplicate key', 'enrollment codes are unique');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE participants SET enrollment_code_used_at = now() WHERE id = '00000000-0000-0000-0000-0000000000f2'$q$, 'participants_enrollment_code_used_check', 'used_at requires an enrollment code');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE participants SET token_sha256 = 'not-a-hash' WHERE id = '00000000-0000-0000-0000-0000000000f1'$q$, 'participants_token_sha256_check', 'token hash must be a hex sha256');
UPDATE participants SET enrollment_code_used_at = now(), token_sha256 = repeat('ab', 32) WHERE id = '00000000-0000-0000-0000-0000000000f1';
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE participants SET token_sha256 = repeat('ab', 32) WHERE id = '00000000-0000-0000-0000-0000000000f2'$q$, 'duplicate key', 'token hashes are unique');

-- ---------- uploads ----------
INSERT INTO sync_batches (id, device_id, participant_id, firmware_version, recorded_from, recorded_to, payload_sha256, device_session_id)
VALUES ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f1', 'fw-1.0',
        '2026-11-20 14:00-03', '2026-11-20 14:30-03', repeat('cd', 32), 'a1b2c3-1795280400');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT status = 'awaiting_files' AND completed_at IS NULL FROM sync_batches WHERE id = '00000000-0000-0000-0000-0000000000e9'),
  'a new upload starts awaiting files');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE sync_batches SET status = 'uploaded', completed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000e9'$q$, 'sync_batches_status_check', 'upload status outside the vocabulary');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE sync_batches SET status = 'processing' WHERE id = '00000000-0000-0000-0000-0000000000e9'$q$, 'sync_batches_completed_check', 'processing requires completed_at');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE sync_batches SET completed_at = now() WHERE id = '00000000-0000-0000-0000-0000000000e9'$q$, 'sync_batches_completed_check', 'awaiting_files has no completed_at');
INSERT INTO jobs (type, payload) VALUES ('process_session', '{"upload_id":"00000000-0000-0000-0000-0000000000e9"}');
UPDATE sync_batches SET status = 'processing', completed_at = now(), job_id = (SELECT max(id) FROM jobs)
WHERE id = '00000000-0000-0000-0000-0000000000e9';
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE sync_batches SET status = 'failed' WHERE id = '00000000-0000-0000-0000-0000000000e9'$q$, 'sync_batches_error_check', 'failed requires an error code');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE sync_batches SET status = 'failed', error_code = 'oops' WHERE id = '00000000-0000-0000-0000-0000000000e9'$q$, 'sync_batches_error_code_check', 'error code outside the vocabulary');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$UPDATE sync_batches SET error_code = 'files_mismatch' WHERE id = '00000000-0000-0000-0000-0000000000e9'$q$, 'sync_batches_error_check', 'only a failed upload has an error code');
UPDATE sync_batches SET status = 'failed', error_code = 'files_mismatch', error_message = 'video.mp4 sha256 differs'
WHERE id = '00000000-0000-0000-0000-0000000000e9';
INSERT INTO results (r) SELECT pg_temp.expect(true, 'processing -> failed with an error code is allowed');
INSERT INTO sync_batch_files (batch_id, kind, sha256, size_bytes, content_type) VALUES
  ('00000000-0000-0000-0000-0000000000e9', 'video', repeat('01', 32), 18234567, 'video/mp4'),
  ('00000000-0000-0000-0000-0000000000e9', 'manifest', repeat('cd', 32), 2048, 'application/json');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO sync_batch_files (batch_id, kind, sha256, size_bytes, content_type) VALUES ('00000000-0000-0000-0000-0000000000e9','video',repeat('02',32),1,'video/mp4')$q$, 'duplicate key', 'one declared file per kind and upload');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO sync_batch_files (batch_id, kind, sha256, size_bytes, content_type) VALUES ('00000000-0000-0000-0000-0000000000e9','audio',repeat('02',32),1,'video/mp4')$q$, 'sync_batch_files_kind_check', 'file kind outside the vocabulary');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO sync_batch_files (batch_id, kind, sha256, size_bytes, content_type) VALUES ('00000000-0000-0000-0000-0000000000e9','frames',repeat('02',32),1,'text/plain')$q$, 'sync_batch_files_content_type_check', 'content type outside the vocabulary');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO sync_batch_files (batch_id, kind, sha256, size_bytes, content_type) VALUES ('00000000-0000-0000-0000-0000000000e9','frames',repeat('02',32),1,'video/mp4')$q$, 'sync_batch_files_kind_content_type_check', 'content type must match the file kind');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO sync_batch_files (batch_id, kind, sha256, size_bytes, content_type) VALUES ('00000000-0000-0000-0000-0000000000e9','frames','ABC',1,'text/csv')$q$, 'sync_batch_files_sha256_check', 'declared sha256 must be lowercase hex');
INSERT INTO results (r) SELECT pg_temp.expect_error($q$INSERT INTO sync_batch_files (batch_id, kind, sha256, size_bytes, content_type) VALUES ('00000000-0000-0000-0000-0000000000e9','frames',repeat('02',32),0,'text/csv')$q$, 'sync_batch_files_size_check', 'declared size must be positive');
INSERT INTO results (r) SELECT pg_temp.expect(
  (SELECT count(*) = 6 FROM sensor_types WHERE key IN ('temperature_c','humidity_pct','co_raw','flammable_gas_raw','sound_level_raw','battery_mv')),
  'the pendant sensor types exist without the seed');
