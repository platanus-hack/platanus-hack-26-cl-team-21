-- Database rules Drizzle can't express: overlap constraints, immutability triggers, the sensor
-- ingest function and read views. drizzle-kit diffs schema.ts against snapshots, never the live DB,
-- so objects created here are not touched by later generated migrations. Changing one of them =
-- a new custom migration (`npm run generate -w db -- --custom --name <what>`).

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- ===================== No-overlap rules =====================
ALTER TABLE participant_protocols ADD CONSTRAINT participant_protocols_no_overlap
  EXCLUDE USING gist (participant_id WITH =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz), '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE device_assignments ADD CONSTRAINT device_assignments_device_no_overlap
  EXCLUDE USING gist (device_id WITH =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz), '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE device_assignments ADD CONSTRAINT device_assignments_participant_no_overlap
  EXCLUDE USING gist (participant_id WITH =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz), '[)') WITH &&);
--> statement-breakpoint
-- One coverage status per participant per instant; the gist index also serves timeline queries.
ALTER TABLE coverage_intervals ADD CONSTRAINT coverage_intervals_no_overlap
  EXCLUDE USING gist (participant_id WITH =, tstzrange(started_at, ended_at, '[)') WITH &&);
--> statement-breakpoint

-- ===================== Published protocols are immutable =====================
CREATE FUNCTION protocol_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'protocol_version % is %, it cannot be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.definition        IS DISTINCT FROM OLD.definition OR
       NEW.definition_sha256 IS DISTINCT FROM OLD.definition_sha256 OR
       NEW.version_label     IS DISTINCT FROM OLD.version_label OR
       NEW.study_id          IS DISTINCT FROM OLD.study_id OR
       NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id OR
       NEW.change_note       IS DISTINCT FROM OLD.change_note OR
       NEW.published_by      IS DISTINCT FROM OLD.published_by OR
       NEW.published_at      IS DISTINCT FROM OLD.published_at OR
       NEW.status = 'draft') THEN
    RAISE EXCEPTION 'protocol_version % is %: publish a new version instead of editing it', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER protocol_versions_guard BEFORE UPDATE OR DELETE ON protocol_versions
  FOR EACH ROW EXECUTE FUNCTION protocol_versions_guard();
--> statement-breakpoint

-- Children of a published version (event types, EMA items, capture windows) are frozen too.
CREATE FUNCTION protocol_children_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ids uuid[];
BEGIN
  v_ids := CASE TG_OP
    WHEN 'INSERT' THEN ARRAY[NEW.protocol_version_id]
    WHEN 'DELETE' THEN ARRAY[OLD.protocol_version_id]
    ELSE ARRAY[NEW.protocol_version_id, OLD.protocol_version_id] END;
  IF EXISTS (SELECT 1 FROM protocol_versions WHERE id = ANY (v_ids) AND status <> 'draft') THEN
    RAISE EXCEPTION '% belongs to a published protocol_version and is immutable', TG_TABLE_NAME;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER event_types_guard BEFORE INSERT OR UPDATE OR DELETE ON event_types
  FOR EACH ROW EXECUTE FUNCTION protocol_children_guard();
--> statement-breakpoint
CREATE TRIGGER ema_items_guard BEFORE INSERT OR UPDATE OR DELETE ON ema_items
  FOR EACH ROW EXECUTE FUNCTION protocol_children_guard();
--> statement-breakpoint
CREATE TRIGGER capture_windows_guard BEFORE INSERT OR UPDATE OR DELETE ON capture_windows
  FOR EACH ROW EXECUTE FUNCTION protocol_children_guard();
--> statement-breakpoint

-- Participants and pipeline runs only use published versions: a draft can still change, so data
-- collected under it would point to a definition that is not the one it ran under.
CREATE FUNCTION protocol_in_use_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM protocol_versions WHERE id = NEW.protocol_version_id AND status = 'draft') THEN
    RAISE EXCEPTION 'protocol_version % is a draft: publish it before using it in %', NEW.protocol_version_id, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER participant_protocols_published_guard BEFORE INSERT OR UPDATE OF protocol_version_id ON participant_protocols
  FOR EACH ROW EXECUTE FUNCTION protocol_in_use_guard();
--> statement-breakpoint
CREATE TRIGGER pipeline_runs_published_guard BEFORE INSERT OR UPDATE OF protocol_version_id ON pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION protocol_in_use_guard();
--> statement-breakpoint

-- ===================== Append-only records =====================
-- Observations: a re-run supersedes them (superseded_by_run_id NULL -> run) and nothing else
-- changes; human corrections go to observation_reviews, which never change at all.
CREATE FUNCTION observations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_by_run_id IS NOT NULL
     OR (to_jsonb(NEW) - 'superseded_by_run_id') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by_run_id') THEN
    RAISE EXCEPTION 'observation % is append-only: only superseded_by_run_id can be set, once', OLD.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER observations_guard BEFORE UPDATE ON observations
  FOR EACH ROW EXECUTE FUNCTION observations_guard();
--> statement-breakpoint
CREATE FUNCTION append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: add a new row instead of updating', TG_TABLE_NAME;
END $$;
--> statement-breakpoint
CREATE TRIGGER observation_reviews_guard BEFORE UPDATE ON observation_reviews
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
--> statement-breakpoint

-- ===================== Participant time zone =====================
-- sensor_daily() converts with AT TIME ZONE, so one unknown zone would break it for the whole study.
CREATE FUNCTION participants_timezone_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM now() AT TIME ZONE NEW.timezone;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER participants_timezone_guard BEFORE INSERT OR UPDATE OF timezone ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_timezone_guard();
--> statement-breakpoint

-- ===================== Sensor series identity =====================
-- Chunks are sized by the series period and attributed to its participant and sensor, so those
-- never change: a new period or a swapped sensor is a new series.
CREATE FUNCTION sensor_series_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.period_s IS DISTINCT FROM OLD.period_s
     OR NEW.participant_id IS DISTINCT FROM OLD.participant_id
     OR NEW.device_sensor_id IS DISTINCT FROM OLD.device_sensor_id THEN
    RAISE EXCEPTION 'sensor_series % is immutable: create a new series instead', OLD.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sensor_series_guard BEFORE UPDATE ON sensor_series
  FOR EACH ROW EXECUTE FUNCTION sensor_series_guard();
--> statement-breakpoint

-- ===================== Sensor ingest =====================
-- Merges readings of one series into hourly chunks. Each timestamp is snapped to the nearest slot
-- (max error period_s/2); a later write to the same slot wins. Idempotent and order-independent:
-- re-sent or out-of-order batches converge to the same chunks. NULL and non-finite values are
-- skipped (not counted), so they never erase a stored reading or poison the hourly stats. Hours are processed in time order
-- so concurrent batches lock rows in the same order (no deadlocks). Returns readings written.
CREATE FUNCTION ingest_sensor_readings(p_series_id int, p_ts timestamptz[], p_vals real[])
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_period smallint;
  v_slots  int;
  v_written int := 0;
  r   record;
  cur real[];
BEGIN
  IF cardinality(p_ts) IS DISTINCT FROM cardinality(p_vals) THEN
    RAISE EXCEPTION 'ingest_sensor_readings: % timestamps but % values', cardinality(p_ts), cardinality(p_vals);
  END IF;
  SELECT period_s INTO v_period FROM sensor_series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ingest_sensor_readings: sensor_series % does not exist', p_series_id;
  END IF;
  v_slots := 3600 / v_period;

  FOR r IN
    WITH snapped AS (
      SELECT u.ord, u.v, u.t + make_interval(secs => v_period / 2.0) AS t2
      FROM unnest(p_ts, p_vals) WITH ORDINALITY AS u(t, v, ord)
      WHERE u.t IS NOT NULL AND u.v IS NOT NULL AND u.v NOT IN ('NaN', 'Infinity', '-Infinity')
    )
    SELECT date_trunc('hour', t2, 'UTC') AS hour,
           array_agg(floor(extract(epoch FROM t2 - date_trunc('hour', t2, 'UTC')) / v_period)::int ORDER BY ord) AS offs,
           array_agg(v ORDER BY ord) AS vs
    FROM snapped
    GROUP BY 1
    ORDER BY 1
  LOOP
    INSERT INTO sensor_chunks (series_id, chunk_start, period_s, vals)
    VALUES (p_series_id, r.hour, v_period, array_fill(NULL::real, ARRAY[v_slots]))
    ON CONFLICT (series_id, chunk_start) DO NOTHING;

    SELECT vals INTO cur FROM sensor_chunks
    WHERE series_id = p_series_id AND chunk_start = r.hour
    FOR UPDATE;

    FOR i IN 1 .. cardinality(r.offs) LOOP
      cur[r.offs[i] + 1] := r.vs[i];
    END LOOP;
    v_written := v_written + cardinality(r.offs);

    UPDATE sensor_chunks SET vals = cur, updated_at = now()
    WHERE series_id = p_series_id AND chunk_start = r.hour;

    -- Stats are recomputed from the whole merged hour, so they can never drift from the values.
    INSERT INTO sensor_hourly (series_id, hour, n, v_sum, v_min, v_max)
    SELECT p_series_id, r.hour, count(x)::smallint, coalesce(sum(x), 0), min(x), max(x)
    FROM unnest(cur) AS x
    ON CONFLICT (series_id, hour) DO UPDATE
      SET n = excluded.n, v_sum = excluded.v_sum, v_min = excluded.v_min, v_max = excluded.v_max;
  END LOOP;
  RETURN v_written;
END $$;
--> statement-breakpoint

-- Per-sensor stats of one participant in [p_from, p_to): the context of an EMA answer or episode.
-- Slices each chunk to the slots inside the window (slot i is at chunk_start + (i-1)*period_s)
-- instead of unnesting the whole hour.
CREATE FUNCTION sensor_window_stats(p_participant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (sensor_type text, unit text, n bigint, mean double precision, min real, max real)
LANGUAGE sql STABLE AS $$
  SELECT ds.sensor_type_key, st.unit, count(x.v), avg(x.v), min(x.v), max(x.v)
  FROM sensor_series ss
  JOIN device_sensors ds ON ds.id = ss.device_sensor_id
  JOIN sensor_types st ON st.key = ds.sensor_type_key
  JOIN sensor_chunks c ON c.series_id = ss.id
   AND c.chunk_start >= date_trunc('hour', p_from, 'UTC')
   AND c.chunk_start < p_to
  CROSS JOIN LATERAL unnest(c.vals[
      greatest(1, ceil(extract(epoch FROM p_from - c.chunk_start) / c.period_s)::int + 1)
    : least(cardinality(c.vals), ceil(extract(epoch FROM p_to - c.chunk_start) / c.period_s)::int)
  ]) AS x(v)
  WHERE ss.participant_id = p_participant_id
  GROUP BY ds.sensor_type_key, st.unit
$$;
--> statement-breakpoint

-- Daily stats per participant x sensor type on the participant's local day, for local days
-- [p_from, p_to] of one study (optionally one participant). Reads only sensor_hourly, and always
-- with a date range, so the cost depends on the range asked for, not on how old the study is.
-- Several series of the same sensor type on one day (device swap) are merged; coverage is the share
-- of the local day covered by readings (n x period of each series), so series with different
-- periods add up correctly. The day length is real, so DST days (23 h / 25 h) don't distort it;
-- `expected` is the reading count at the finest period of that day.
-- Assumes whole-hour UTC offsets (true for Chile); half-hour zones would need 30-min chunks.
CREATE FUNCTION sensor_daily(p_study_id uuid, p_from date, p_to date, p_participant_id uuid DEFAULT NULL)
RETURNS TABLE (participant_id uuid, sensor_type text, unit text, local_day date, n int, expected int,
               coverage double precision, mean double precision, min real, max real)
LANGUAGE sql STABLE AS $$
  WITH per_day AS (
    SELECT ss.participant_id,
           ds.sensor_type_key AS sensor_type,
           p.timezone,
           (h.hour AT TIME ZONE p.timezone)::date AS local_day,
           min(ss.period_s) AS period_s,
           sum(h.n)::int AS n,
           sum(h.n * ss.period_s)::double precision AS covered_s,
           sum(h.v_sum) AS v_sum,
           min(h.v_min) AS v_min,
           max(h.v_max) AS v_max
    FROM participants p
    JOIN sensor_series ss ON ss.participant_id = p.id
    JOIN device_sensors ds ON ds.id = ss.device_sensor_id
    JOIN sensor_hourly h ON h.series_id = ss.id
     AND h.hour >= (p_from::timestamp AT TIME ZONE p.timezone)
     AND h.hour <  ((p_to + 1)::timestamp AT TIME ZONE p.timezone)
     -- same range widened to the max UTC offset: constant, so the planner can range-scan the PK
     AND h.hour >= (p_from::timestamp AT TIME ZONE 'UTC') - interval '14 hours'
     AND h.hour <  ((p_to + 1)::timestamp AT TIME ZONE 'UTC') + interval '14 hours'
    WHERE p.study_id = p_study_id
      AND (p_participant_id IS NULL OR p.id = p_participant_id)
    GROUP BY 1, 2, 3, 4
  )
  SELECT d.participant_id, d.sensor_type, st.unit, d.local_day, d.n, (e.day_s / d.period_s)::int,
         d.covered_s / e.day_s, d.v_sum / nullif(d.n, 0), d.v_min, d.v_max
  FROM per_day d
  JOIN sensor_types st ON st.key = d.sensor_type
  CROSS JOIN LATERAL (
    SELECT extract(epoch FROM ((d.local_day + 1)::timestamp AT TIME ZONE d.timezone)
                            - (d.local_day::timestamp AT TIME ZONE d.timezone))::double precision AS day_s
  ) e
$$;
--> statement-breakpoint

-- ===================== Read views =====================

-- Model observations as they currently stand: not superseded by a re-run, latest human review applied.
CREATE VIEW v_current_observations AS
SELECT o.id,
       o.participant_id,
       o.pipeline_run_id,
       coalesce(r.corrected_event_type_id, o.event_type_id) AS event_type_id,
       coalesce(r.corrected_started_at, o.started_at) AS started_at,
       coalesce(r.corrected_ended_at, o.ended_at) AS ended_at,
       coalesce(r.corrected_attributes, o.attributes) AS attributes,
       o.confidence,
       coalesce(r.decision, 'pending') AS human_review_status,
       r.created_at AS reviewed_at
FROM observations o
LEFT JOIN LATERAL (
  SELECT * FROM observation_reviews rv WHERE rv.observation_id = o.id ORDER BY rv.created_at DESC, rv.id DESC LIMIT 1
) r ON true
WHERE o.superseded_by_run_id IS NULL
  AND r.decision IS DISTINCT FROM 'rejected';
--> statement-breakpoint

-- Effective retention of each file still in storage: base retention, extended by the latest active
-- hold but never past studies.max_hold_days after the base date. The purge job reads this view.
CREATE VIEW v_media_retention AS
SELECT m.id,
       m.participant_id,
       m.storage_key,
       greatest(m.base_retain_until,
                least(coalesce(h.expires_at, m.base_retain_until),
                      m.base_retain_until + make_interval(days => s.max_hold_days))) AS retain_until
FROM media_assets m
JOIN participants p ON p.id = m.participant_id
JOIN studies s ON s.id = p.study_id
LEFT JOIN LATERAL (
  SELECT max(rh.expires_at) AS expires_at FROM retention_holds rh
  WHERE rh.media_asset_id = m.id AND rh.released_at IS NULL
) h ON true
WHERE m.storage_key IS NOT NULL;
