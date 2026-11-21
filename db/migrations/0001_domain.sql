CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TABLE "researchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "researchers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"media_retention_days" integer DEFAULT 7 NOT NULL,
	"max_hold_days" integer DEFAULT 14 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studies_code_unique" UNIQUE("code"),
	CONSTRAINT "studies_status_check" CHECK ("studies"."status" in ('draft', 'active', 'paused', 'closed')),
	CONSTRAINT "studies_retention_check" CHECK ("studies"."media_retention_days" between 0 and 30 and "studies"."max_hold_days" between 0 and 60)
);
--> statement-breakpoint
CREATE TABLE "study_members" (
	"study_id" uuid NOT NULL,
	"researcher_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "study_members_study_id_researcher_id_pk" PRIMARY KEY("study_id","researcher_id"),
	CONSTRAINT "study_members_role_check" CHECK ("study_members"."role" in ('owner', 'analyst', 'reviewer', 'annotator'))
);
--> statement-breakpoint
CREATE TABLE "capture_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_version_id" uuid NOT NULL,
	"label" text,
	"days_of_week" smallint[] NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"notice_minutes" integer DEFAULT 5 NOT NULL,
	"max_clip_seconds" integer DEFAULT 60 NOT NULL,
	"max_postpones" integer DEFAULT 2 NOT NULL,
	"postpone_minutes" integer DEFAULT 15 NOT NULL,
	CONSTRAINT "capture_windows_time_check" CHECK ("capture_windows"."end_time" > "capture_windows"."start_time"),
	CONSTRAINT "capture_windows_days_check" CHECK ("capture_windows"."days_of_week" <@ array[1,2,3,4,5,6,7]::smallint[])
);
--> statement-breakpoint
CREATE TABLE "ema_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"prompt" text NOT NULL,
	"response_type" text NOT NULL,
	"options" jsonb,
	"trigger_rule" jsonb NOT NULL,
	CONSTRAINT "ema_items_protocolVersionId_key_unique" UNIQUE("protocol_version_id","key"),
	CONSTRAINT "ema_items_response_type_check" CHECK ("ema_items"."response_type" in ('likert', 'binary', 'choice', 'numeric'))
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"attributes_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "event_types_protocolVersionId_key_unique" UNIQUE("protocol_version_id","key")
);
--> statement-breakpoint
CREATE TABLE "protocol_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"parent_version_id" uuid,
	"definition" jsonb NOT NULL,
	"definition_sha256" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"change_note" text,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_versions_studyId_versionLabel_unique" UNIQUE("study_id","version_label"),
	CONSTRAINT "protocol_versions_status_check" CHECK ("protocol_versions"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "protocol_versions_published_check" CHECK ("protocol_versions"."status" = 'draft' or ("protocol_versions"."published_at" is not null and "protocol_versions"."definition_sha256" is not null))
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"document_version" text NOT NULL,
	"document_sha256" text NOT NULL,
	"allows_camera" boolean NOT NULL,
	"allows_retention_extension" boolean DEFAULT false NOT NULL,
	"allows_external_processing" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "consents_revoked_check" CHECK ("consents"."revoked_at" is null or "consents"."revoked_at" >= "consents"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "identity"."participant_identities" (
	"participant_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"national_id_hash" text,
	"signed_consent_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participant_protocols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"protocol_version_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "participant_protocols_range_check" CHECK ("participant_protocols"."valid_to" is null or "participant_protocols"."valid_to" > "participant_protocols"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"pseudonym" text NOT NULL,
	"arm" text,
	"timezone" text DEFAULT 'America/Santiago' NOT NULL,
	"status" text DEFAULT 'enrolled' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "participants_studyId_pseudonym_unique" UNIQUE("study_id","pseudonym"),
	CONSTRAINT "participants_status_check" CHECK ("participants"."status" in ('enrolled', 'active', 'withdrawn', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "device_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "device_assignments_range_check" CHECK ("device_assignments"."valid_to" is null or "device_assignments"."valid_to" > "device_assignments"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "device_heartbeats" (
	"device_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"battery_pct" real,
	"storage_free_mb" integer,
	"firmware_version" text NOT NULL,
	"rtc_drift_ms" integer,
	CONSTRAINT "device_heartbeats_device_id_received_at_pk" PRIMARY KEY("device_id","received_at")
);
--> statement-breakpoint
CREATE TABLE "device_sensors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"sensor_type_key" text NOT NULL,
	"component_model" text NOT NULL,
	"calibration" jsonb,
	"calibrated_at" timestamp with time zone,
	"installed_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial" text NOT NULL,
	"hardware_revision" text NOT NULL,
	"form_factor" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_serial_unique" UNIQUE("serial"),
	CONSTRAINT "devices_form_factor_check" CHECK ("devices"."form_factor" in ('wristband', 'clip', 'pendant'))
);
--> statement-breakpoint
CREATE TABLE "sensor_types" (
	"key" text PRIMARY KEY NOT NULL,
	"unit" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "coverage_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"device_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"batch_id" uuid,
	CONSTRAINT "coverage_intervals_status_check" CHECK ("coverage_intervals"."status" in ('observed', 'excluded_by_participant', 'privacy_switch', 'device_off', 'low_battery', 'no_upload', 'low_quality')),
	CONSTRAINT "coverage_intervals_source_check" CHECK ("coverage_intervals"."source" in ('device', 'app', 'derived')),
	CONSTRAINT "coverage_intervals_range_check" CHECK ("coverage_intervals"."ended_at" > "coverage_intervals"."started_at")
);
--> statement-breakpoint
CREATE TABLE "device_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"batch_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb,
	"firmware_version" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_events_kind_check" CHECK ("device_events"."kind" in ('privacy_switch_on', 'privacy_switch_off', 'charging_started', 'charging_stopped', 'low_battery', 'button_press', 'storage_full', 'sensor_fault'))
);
--> statement-breakpoint
CREATE TABLE "sensor_chunks" (
	"series_id" integer NOT NULL,
	"chunk_start" timestamp with time zone NOT NULL,
	"period_s" smallint NOT NULL,
	"vals" real[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sensor_chunks_series_id_chunk_start_pk" PRIMARY KEY("series_id","chunk_start"),
	CONSTRAINT "sensor_chunks_hour_check" CHECK (date_trunc('hour', "sensor_chunks"."chunk_start", 'UTC') = "sensor_chunks"."chunk_start"),
	CONSTRAINT "sensor_chunks_len_check" CHECK (cardinality("sensor_chunks"."vals") = 3600 / "sensor_chunks"."period_s")
);
--> statement-breakpoint
CREATE TABLE "sensor_hourly" (
	"series_id" integer NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"n" smallint NOT NULL,
	"v_sum" double precision NOT NULL,
	"v_min" real,
	"v_max" real,
	CONSTRAINT "sensor_hourly_series_id_hour_pk" PRIMARY KEY("series_id","hour")
);
--> statement-breakpoint
CREATE TABLE "sensor_series" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensor_series_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"participant_id" uuid NOT NULL,
	"device_sensor_id" uuid NOT NULL,
	"period_s" smallint NOT NULL,
	CONSTRAINT "sensor_series_participantId_deviceSensorId_unique" UNIQUE("participant_id","device_sensor_id"),
	CONSTRAINT "sensor_series_period_check" CHECK ("sensor_series"."period_s" > 0 and 3600 % "sensor_series"."period_s" = 0)
);
--> statement-breakpoint
CREATE TABLE "sync_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"firmware_version" text NOT NULL,
	"app_version" text,
	"recorded_from" timestamp with time zone NOT NULL,
	"recorded_to" timestamp with time zone NOT NULL,
	"payload_sha256" text NOT NULL,
	"raw_storage_key" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_batches_deviceId_payloadSha256_unique" UNIQUE("device_id","payload_sha256"),
	CONSTRAINT "sync_batches_range_check" CHECK ("sync_batches"."recorded_to" >= "sync_batches"."recorded_from")
);
--> statement-breakpoint
CREATE TABLE "capture_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"capture_window_id" uuid,
	"parent_prompt_id" uuid,
	"scheduled_for" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"outcome" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "capture_prompts_outcome_check" CHECK ("capture_prompts"."outcome" in ('pending', 'accepted', 'postponed', 'declined', 'missed', 'manual')),
	CONSTRAINT "capture_prompts_manual_check" CHECK (("capture_prompts"."outcome" = 'manual') = ("capture_prompts"."capture_window_id" is null))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"capture_prompt_id" uuid,
	"firmware_version" text NOT NULL,
	"kind" text NOT NULL,
	"recorded_from" timestamp with time zone NOT NULL,
	"recorded_to" timestamp with time zone NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" text,
	"storage_key" text,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base_retain_until" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" text,
	CONSTRAINT "media_assets_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "media_assets_kind_check" CHECK ("media_assets"."kind" in ('video', 'image')),
	CONSTRAINT "media_assets_status_check" CHECK ("media_assets"."status" in ('uploaded', 'processing', 'processed', 'failed', 'deleted')),
	CONSTRAINT "media_assets_range_check" CHECK ("media_assets"."recorded_to" >= "media_assets"."recorded_from"),
	CONSTRAINT "media_assets_tombstone_check" CHECK (("media_assets"."status" = 'deleted') = ("media_assets"."storage_key" is null) and ("media_assets"."status" = 'deleted') = ("media_assets"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "observation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"start_second" real NOT NULL,
	"end_second" real NOT NULL,
	CONSTRAINT "observation_evidence_range_check" CHECK ("observation_evidence"."start_second" >= 0 and "observation_evidence"."end_second" > "observation_evidence"."start_second")
);
--> statement-breakpoint
CREATE TABLE "observation_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"corrected_event_type_id" uuid,
	"corrected_started_at" timestamp with time zone,
	"corrected_ended_at" timestamp with time zone,
	"corrected_attributes" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "observation_reviews_decision_check" CHECK ("observation_reviews"."decision" in ('confirmed', 'corrected', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"pipeline_run_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real,
	"quality" jsonb,
	"superseded_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observations_range_check" CHECK ("observations"."ended_at" >= "observations"."started_at"),
	CONSTRAINT "observations_confidence_check" CHECK ("observations"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "pipeline_run_inputs" (
	"run_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	CONSTRAINT "pipeline_run_inputs_run_id_media_asset_id_pk" PRIMARY KEY("run_id","media_asset_id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"protocol_version_id" uuid NOT NULL,
	"job_id" integer,
	"trigger" text NOT NULL,
	"model_provider" text NOT NULL,
	"model_name" text NOT NULL,
	"model_version" text NOT NULL,
	"prompt_sha256" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pipeline_version" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "pipeline_runs_trigger_check" CHECK ("pipeline_runs"."trigger" in ('upload', 'reprocess', 'discrepancy')),
	CONSTRAINT "pipeline_runs_status_check" CHECK ("pipeline_runs"."status" in ('queued', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "activity_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	CONSTRAINT "activity_reports_channel_check" CHECK ("activity_reports"."channel" in ('device_button', 'app')),
	CONSTRAINT "activity_reports_range_check" CHECK ("activity_reports"."ended_at" >= "activity_reports"."started_at")
);
--> statement-breakpoint
CREATE TABLE "discrepancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"activity_report_id" uuid,
	"observation_id" uuid,
	"detector_version" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"reprocess_run_id" uuid,
	"note" text,
	CONSTRAINT "discrepancies_pair_unique" UNIQUE NULLS NOT DISTINCT("kind","activity_report_id","observation_id"),
	CONSTRAINT "discrepancies_kind_check" CHECK ("discrepancies"."kind" in ('reported_not_detected', 'detected_not_reported', 'category_mismatch', 'timing_mismatch', 'value_mismatch')),
	CONSTRAINT "discrepancies_status_check" CHECK ("discrepancies"."status" in ('open', 'reprocessing', 'resolved')),
	CONSTRAINT "discrepancies_resolution_check" CHECK ("discrepancies"."resolution" in ('model_error', 'report_error', 'capture_failure', 'ambiguous', 'no_evidence')),
	CONSTRAINT "discrepancies_side_check" CHECK ("discrepancies"."activity_report_id" is not null or "discrepancies"."observation_id" is not null),
	CONSTRAINT "discrepancies_resolved_check" CHECK (("discrepancies"."status" = 'resolved') = ("discrepancies"."resolution" is not null))
);
--> statement-breakpoint
CREATE TABLE "ema_prompts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"ema_item_id" uuid NOT NULL,
	"prompted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	CONSTRAINT "ema_prompts_channel_check" CHECK ("ema_prompts"."channel" in ('device_button', 'app'))
);
--> statement-breakpoint
CREATE TABLE "ema_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"ema_item_id" uuid NOT NULL,
	"prompt_id" uuid,
	"answered_at" timestamp with time zone NOT NULL,
	"channel" text NOT NULL,
	"device_id" uuid,
	"value_numeric" real,
	"value_choice" text,
	CONSTRAINT "ema_responses_promptId_unique" UNIQUE("prompt_id"),
	CONSTRAINT "ema_responses_channel_check" CHECK ("ema_responses"."channel" in ('device_button', 'app')),
	CONSTRAINT "ema_responses_value_check" CHECK ("ema_responses"."value_numeric" is not null or "ema_responses"."value_choice" is not null)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_type_check" CHECK ("audit_log"."actor_type" in ('researcher', 'participant', 'system'))
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"params" jsonb NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"storage_key" text,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_format_check" CHECK ("exports"."format" in ('csv', 'json', 'parquet')),
	CONSTRAINT "exports_status_check" CHECK ("exports"."status" in ('queued', 'running', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "external_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"measured_at" timestamp with time zone,
	"source" text,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"annotator_id" uuid NOT NULL,
	"media_asset_id" uuid,
	"event_type_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_annotations_range_check" CHECK ("reference_annotations"."ended_at" >= "reference_annotations"."started_at")
);
--> statement-breakpoint
CREATE TABLE "retention_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"discrepancy_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "retention_holds_reason_check" CHECK ("retention_holds"."reason" in ('discrepancy', 'reference_annotation', 'manual_review')),
	CONSTRAINT "retention_holds_discrepancy_check" CHECK ("retention_holds"."reason" <> 'discrepancy' or "retention_holds"."discrepancy_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_created_by_researchers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_members" ADD CONSTRAINT "study_members_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_members" ADD CONSTRAINT "study_members_researcher_id_researchers_id_fk" FOREIGN KEY ("researcher_id") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_windows" ADD CONSTRAINT "capture_windows_protocol_version_id_protocol_versions_id_fk" FOREIGN KEY ("protocol_version_id") REFERENCES "public"."protocol_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ema_items" ADD CONSTRAINT "ema_items_protocol_version_id_protocol_versions_id_fk" FOREIGN KEY ("protocol_version_id") REFERENCES "public"."protocol_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_protocol_version_id_protocol_versions_id_fk" FOREIGN KEY ("protocol_version_id") REFERENCES "public"."protocol_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_parent_version_id_protocol_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."protocol_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_versions" ADD CONSTRAINT "protocol_versions_published_by_researchers_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."participant_identities" ADD CONSTRAINT "participant_identities_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_protocols" ADD CONSTRAINT "participant_protocols_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_protocols" ADD CONSTRAINT "participant_protocols_protocol_version_id_protocol_versions_id_fk" FOREIGN KEY ("protocol_version_id") REFERENCES "public"."protocol_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sensors" ADD CONSTRAINT "device_sensors_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sensors" ADD CONSTRAINT "device_sensors_sensor_type_key_sensor_types_key_fk" FOREIGN KEY ("sensor_type_key") REFERENCES "public"."sensor_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_intervals" ADD CONSTRAINT "coverage_intervals_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_intervals" ADD CONSTRAINT "coverage_intervals_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_intervals" ADD CONSTRAINT "coverage_intervals_batch_id_sync_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sync_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_batch_id_sync_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sync_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_chunks" ADD CONSTRAINT "sensor_chunks_series_id_sensor_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."sensor_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_hourly" ADD CONSTRAINT "sensor_hourly_series_id_hour_sensor_chunks_series_id_chunk_start_fk" FOREIGN KEY ("series_id","hour") REFERENCES "public"."sensor_chunks"("series_id","chunk_start") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_series" ADD CONSTRAINT "sensor_series_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_series" ADD CONSTRAINT "sensor_series_device_sensor_id_device_sensors_id_fk" FOREIGN KEY ("device_sensor_id") REFERENCES "public"."device_sensors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_batches" ADD CONSTRAINT "sync_batches_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_prompts" ADD CONSTRAINT "capture_prompts_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_prompts" ADD CONSTRAINT "capture_prompts_capture_window_id_capture_windows_id_fk" FOREIGN KEY ("capture_window_id") REFERENCES "public"."capture_windows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_prompts" ADD CONSTRAINT "capture_prompts_parent_prompt_id_capture_prompts_id_fk" FOREIGN KEY ("parent_prompt_id") REFERENCES "public"."capture_prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_capture_prompt_id_capture_prompts_id_fk" FOREIGN KEY ("capture_prompt_id") REFERENCES "public"."capture_prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_evidence" ADD CONSTRAINT "observation_evidence_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_evidence" ADD CONSTRAINT "observation_evidence_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_reviews" ADD CONSTRAINT "observation_reviews_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_reviews" ADD CONSTRAINT "observation_reviews_reviewer_id_researchers_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_reviews" ADD CONSTRAINT "observation_reviews_corrected_event_type_id_event_types_id_fk" FOREIGN KEY ("corrected_event_type_id") REFERENCES "public"."event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_superseded_by_run_id_pipeline_runs_id_fk" FOREIGN KEY ("superseded_by_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_inputs" ADD CONSTRAINT "pipeline_run_inputs_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run_inputs" ADD CONSTRAINT "pipeline_run_inputs_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_protocol_version_id_protocol_versions_id_fk" FOREIGN KEY ("protocol_version_id") REFERENCES "public"."protocol_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reports" ADD CONSTRAINT "activity_reports_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reports" ADD CONSTRAINT "activity_reports_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_activity_report_id_activity_reports_id_fk" FOREIGN KEY ("activity_report_id") REFERENCES "public"."activity_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_resolved_by_researchers_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_reprocess_run_id_pipeline_runs_id_fk" FOREIGN KEY ("reprocess_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ema_prompts" ADD CONSTRAINT "ema_prompts_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ema_prompts" ADD CONSTRAINT "ema_prompts_ema_item_id_ema_items_id_fk" FOREIGN KEY ("ema_item_id") REFERENCES "public"."ema_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ema_responses" ADD CONSTRAINT "ema_responses_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ema_responses" ADD CONSTRAINT "ema_responses_ema_item_id_ema_items_id_fk" FOREIGN KEY ("ema_item_id") REFERENCES "public"."ema_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ema_responses" ADD CONSTRAINT "ema_responses_prompt_id_ema_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ema_prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ema_responses" ADD CONSTRAINT "ema_responses_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_researchers_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_variables" ADD CONSTRAINT "external_variables_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_variables" ADD CONSTRAINT "external_variables_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_variables" ADD CONSTRAINT "external_variables_uploaded_by_researchers_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_annotations" ADD CONSTRAINT "reference_annotations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_annotations" ADD CONSTRAINT "reference_annotations_annotator_id_researchers_id_fk" FOREIGN KEY ("annotator_id") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_annotations" ADD CONSTRAINT "reference_annotations_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_annotations" ADD CONSTRAINT "reference_annotations_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_discrepancy_id_discrepancies_id_fk" FOREIGN KEY ("discrepancy_id") REFERENCES "public"."discrepancies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_created_by_researchers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."researchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_participant_id_index" ON "consents" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "device_sensors_device_id_index" ON "device_sensors" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "device_events_device_id_occurred_at_index" ON "device_events" USING btree ("device_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sync_batches_participant_id_recorded_from_index" ON "sync_batches" USING btree ("participant_id","recorded_from");--> statement-breakpoint
CREATE INDEX "capture_prompts_participant_id_scheduled_for_index" ON "capture_prompts" USING btree ("participant_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "media_assets_participant_id_recorded_from_index" ON "media_assets" USING btree ("participant_id","recorded_from");--> statement-breakpoint
CREATE INDEX "media_assets_purge_idx" ON "media_assets" USING btree ("base_retain_until") WHERE "media_assets"."storage_key" is not null;--> statement-breakpoint
CREATE INDEX "observation_evidence_observation_id_index" ON "observation_evidence" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "observation_evidence_media_asset_id_index" ON "observation_evidence" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "observation_reviews_observation_id_created_at_index" ON "observation_reviews" USING btree ("observation_id","created_at");--> statement-breakpoint
CREATE INDEX "observations_participant_id_started_at_index" ON "observations" USING btree ("participant_id","started_at");--> statement-breakpoint
CREATE INDEX "observations_current_idx" ON "observations" USING btree ("participant_id","started_at") WHERE "observations"."superseded_by_run_id" is null;--> statement-breakpoint
CREATE INDEX "activity_reports_participant_id_started_at_index" ON "activity_reports" USING btree ("participant_id","started_at");--> statement-breakpoint
CREATE INDEX "discrepancies_open_idx" ON "discrepancies" USING btree ("participant_id") WHERE "discrepancies"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "ema_prompts_participant_id_prompted_at_index" ON "ema_prompts" USING btree ("participant_id","prompted_at");--> statement-breakpoint
CREATE INDEX "ema_responses_participant_id_answered_at_index" ON "ema_responses" USING btree ("participant_id","answered_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_entity_id_index" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "external_variables_participant_id_key_index" ON "external_variables" USING btree ("participant_id","key");--> statement-breakpoint
CREATE INDEX "reference_annotations_participant_id_started_at_index" ON "reference_annotations" USING btree ("participant_id","started_at");--> statement-breakpoint
CREATE INDEX "retention_holds_media_asset_id_index" ON "retention_holds" USING btree ("media_asset_id");