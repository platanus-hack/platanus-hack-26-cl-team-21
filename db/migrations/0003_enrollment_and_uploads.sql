CREATE TABLE "sync_batch_files" (
	"batch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	CONSTRAINT "sync_batch_files_batch_id_kind_pk" PRIMARY KEY("batch_id","kind"),
	CONSTRAINT "sync_batch_files_kind_check" CHECK ("sync_batch_files"."kind" in ('video', 'frames', 'sensors', 'events', 'manifest')),
	CONSTRAINT "sync_batch_files_content_type_check" CHECK ("sync_batch_files"."content_type" in ('video/mp4', 'text/csv', 'application/json')),
	CONSTRAINT "sync_batch_files_sha256_check" CHECK ("sync_batch_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sync_batch_files_size_check" CHECK ("sync_batch_files"."size_bytes" > 0),
	CONSTRAINT "sync_batch_files_kind_content_type_check" CHECK ("sync_batch_files"."content_type" = case "sync_batch_files"."kind" when 'video' then 'video/mp4' when 'manifest' then 'application/json' else 'text/csv' end)
);
--> statement-breakpoint
ALTER TABLE "device_events" DROP CONSTRAINT "device_events_kind_check";--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "enrollment_code" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "enrollment_code_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "token_sha256" text;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD COLUMN "device_session_id" text;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD COLUMN "status" text DEFAULT 'awaiting_files' NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD COLUMN "job_id" integer;--> statement-breakpoint
ALTER TABLE "sync_batch_files" ADD CONSTRAINT "sync_batch_files_batch_id_sync_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sync_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_enrollmentCode_unique" UNIQUE("enrollment_code");--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_tokenSha256_unique" UNIQUE("token_sha256");--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_enrollment_code_used_check" CHECK ("participants"."enrollment_code_used_at" is null or "participants"."enrollment_code" is not null);--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_token_sha256_check" CHECK ("participants"."token_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_kind_check" CHECK ("device_events"."kind" in ('privacy_switch_on', 'privacy_switch_off', 'charging_started', 'charging_stopped', 'low_battery', 'button_press', 'storage_full', 'sensor_fault', 'boot', 'rtc_set', 'rtc_lost', 'camera_boot'));--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_status_check" CHECK ("sync_batches"."status" in ('awaiting_files', 'processing', 'processed', 'failed'));--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_error_code_check" CHECK ("sync_batches"."error_code" in ('processing_failed', 'files_mismatch'));--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_completed_check" CHECK (("sync_batches"."status" = 'awaiting_files') = ("sync_batches"."completed_at" is null));--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_error_check" CHECK (("sync_batches"."status" = 'failed') = ("sync_batches"."error_code" is not null));--> statement-breakpoint
-- Hand-written data changes (not part of the schema diff).
-- Batches stored before the upload API existed were already ingested.
UPDATE "sync_batches" SET "status" = 'processed', "completed_at" = "received_at";--> statement-breakpoint
-- The sensors the pendant reports in sensors.csv (ADR 0002 §7), so ingestion works without the demo seed.
INSERT INTO "sensor_types" ("key", "unit", "description") VALUES
  ('temperature_c', 'C', 'Ambient temperature (DHT11)'),
  ('humidity_pct', '%', 'Relative humidity (DHT11)'),
  ('co_raw', 'raw', 'CO, relative ADC reading (MQ-7), not calibrated'),
  ('flammable_gas_raw', 'raw', 'Flammable gas/smoke, relative ADC reading (MQ-2), not calibrated'),
  ('sound_level_raw', 'raw', 'Sound level, relative ADC reading (KY-037), not calibrated dB'),
  ('battery_mv', 'mV', 'Battery pack voltage (2S, voltage divider on the sensor hub)')
ON CONFLICT ("key") DO NOTHING;
