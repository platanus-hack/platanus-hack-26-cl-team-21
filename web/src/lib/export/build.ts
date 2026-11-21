import { createHash, randomUUID } from "node:crypto";
import { auditLog, db, exports } from "@observatorio/db";
import { type CsvValue, toCsv } from "./csv";
import { type Dataset, type ExportRequest, toExportParams } from "./params";
import {
  type CoverageExportRow,
  type ExportStudy,
  type ObservationExportRow,
  selectCoverage,
  selectObservations,
} from "./queries";
import { isoWithOffset } from "./time";
import { createZip } from "./zip";

// Builds an export file on demand and records it (exports + audit_log) in the same transaction as
// the reads, so the stored sha256 and row counts describe exactly the returned bytes. There is no
// object storage yet: the file is streamed back once and exports.storage_key stays null.

export const OBSERVATION_COLUMNS = [
  "study_code",
  "participant",
  "observation_id",
  "event_type",
  "started_at",
  "ended_at",
  "duration_seconds",
  "attributes",
  "model_confidence",
  "human_review_status",
  "reviewed_at",
  "protocol_version",
  "model_provider",
  "model_name",
  "model_version",
  "pipeline_version",
  "pipeline_run_id",
  "device_serials",
  "firmware_versions",
  "evidence",
] as const;

export const COVERAGE_COLUMNS = [
  "study_code",
  "participant",
  "coverage_interval_id",
  "started_at",
  "ended_at",
  "duration_seconds",
  "status",
  "source",
  "device_serial",
  "firmware_version",
  "batch_id",
] as const;

const NOTES = {
  coverage:
    "Time that was not observed (privacy switch, participant exclusion, device off, low battery, no upload, low quality, or no coverage record at all) is described by the coverage intervals. The absence of an observation in time that was not observed is not a zero: nothing can be concluded about it.",
  coverageMissing:
    "This export does not include the coverage intervals. Without them, the absence of an observation cannot be interpreted: it is not a zero in time that was not observed. Export the coverage intervals with the same filters before analysing counts or rates.",
  confidence: "model_confidence is the raw score returned by the model (0 to 1). It is not a calibrated probability.",
  current:
    "Observations are the current ones: superseded pipeline runs and observations rejected by a human reviewer are excluded, and the latest human correction is applied.",
  dates:
    "Date filters use each participant's local day. Observations are included when they start inside the range; coverage intervals are included whole (not clipped) when they overlap it.",
  timestamps: "Timestamps are ISO 8601 with the participant's local UTC offset at that instant.",
  evidence:
    "evidence lists the authentic source clips: clip_id, the sha256 of the original file and the start/end second inside it.",
} as const;

const seconds = (fromMs: number, toMs: number) => (Math.round(toMs) - Math.round(fromMs)) / 1000;
const iso = (ms: number | null, timeZone: string) => (ms === null ? null : isoWithOffset(ms, timeZone));

function observationRecord(studyCode: string, o: ObservationExportRow) {
  return {
    study_code: studyCode,
    participant: o.pseudonym,
    observation_id: o.id,
    event_type: o.event_type,
    started_at: isoWithOffset(o.started_ms, o.timezone),
    ended_at: isoWithOffset(o.ended_ms, o.timezone),
    duration_seconds: seconds(o.started_ms, o.ended_ms),
    attributes: o.attributes ?? {},
    model_confidence: o.confidence,
    human_review_status: o.human_review_status,
    reviewed_at: iso(o.reviewed_ms, o.timezone),
    protocol_version: o.protocol_version,
    model_provider: o.model_provider,
    model_name: o.model_name,
    model_version: o.model_version,
    pipeline_version: o.pipeline_version,
    pipeline_run_id: o.pipeline_run_id,
    device_serials: o.device_serials,
    firmware_versions: o.firmware_versions,
    evidence: o.evidence,
  };
}

function coverageRecord(studyCode: string, c: CoverageExportRow) {
  return {
    study_code: studyCode,
    participant: c.pseudonym,
    coverage_interval_id: c.id,
    started_at: isoWithOffset(c.started_ms, c.timezone),
    ended_at: isoWithOffset(c.ended_ms, c.timezone),
    duration_seconds: seconds(c.started_ms, c.ended_ms),
    status: c.status,
    source: c.source,
    device_serial: c.device_serial,
    firmware_version: c.firmware_version,
    batch_id: c.batch_id,
  };
}

type ObservationRecord = ReturnType<typeof observationRecord>;

// CSV cells are flat: lists are joined with ";" and nested values are JSON.
function observationCsvRow(r: ObservationRecord): Record<(typeof OBSERVATION_COLUMNS)[number], CsvValue> {
  return {
    ...r,
    attributes: JSON.stringify(r.attributes),
    device_serials: r.device_serials.join(";"),
    firmware_versions: r.firmware_versions.join(";"),
    evidence: JSON.stringify(r.evidence),
  };
}

const unique = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => v !== null))].sort();

function distinctModels(observations: ObservationRecord[]) {
  const models = new Map<string, { provider: string; name: string; version: string }>();
  for (const o of observations) {
    models.set(`${o.model_provider}\u0000${o.model_name}\u0000${o.model_version}`, {
      provider: o.model_provider,
      name: o.model_name,
      version: o.model_version,
    });
  }
  return [...models.values()];
}

function fileStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const encoder = new TextEncoder();

export type ExportFile = {
  exportId: string;
  fileName: string;
  contentType: string;
  body: Uint8Array;
  sha256: string;
  rowCounts: Partial<Record<Dataset, number>>;
};

export async function runExport(study: ExportStudy, request: ExportRequest): Promise<ExportFile> {
  const exportId = randomUUID();
  const generatedAt = new Date();
  const params = toExportParams(request);
  const wants = (dataset: Dataset) => request.datasets.includes(dataset);

  // Repeatable read: both datasets come from the same snapshot.
  return db.transaction(
    async (tx) => {
      const [observationRows, coverageRows] = await Promise.all([
        wants("observations") ? selectObservations(tx, study.id, request.filters) : null,
        wants("coverage_intervals") ? selectCoverage(tx, study.id, request.filters) : null,
      ]);
      const observations = observationRows?.map((o) => observationRecord(study.code, o)) ?? null;
      const coverage = coverageRows?.map((c) => coverageRecord(study.code, c)) ?? null;

      const rowCounts: ExportFile["rowCounts"] = {};
      if (observations) rowCounts.observations = observations.length;
      if (coverage) rowCounts.coverage_intervals = coverage.length;

      const safeCode = study.code.replace(/[^A-Za-z0-9._-]/g, "_");
      const datasetPart = request.datasets.length > 1 ? "observations_coverage" : request.datasets[0];
      const baseName = `${safeCode}_${datasetPart}_${fileStamp(generatedAt)}`;

      let file: Pick<ExportFile, "fileName" | "contentType" | "body">;
      if (request.format === "json") {
        const document = {
          metadata: {
            export_id: exportId,
            generated_at: generatedAt.toISOString(),
            study: { code: study.code, title: study.title },
            format: "json",
            datasets: request.datasets,
            filters: params.filters,
            row_counts: rowCounts,
            versions: {
              protocol_versions: unique(observations?.map((o) => o.protocol_version) ?? []),
              pipeline_versions: unique(observations?.map((o) => o.pipeline_version) ?? []),
              models: distinctModels(observations ?? []),
              firmware_versions: unique([
                ...(observations?.flatMap((o) => o.firmware_versions) ?? []),
                ...(coverage?.map((c) => c.firmware_version) ?? []),
              ]),
            },
            notes: [
              coverage ? NOTES.coverage : NOTES.coverageMissing,
              ...(observations ? [NOTES.current, NOTES.confidence, NOTES.evidence] : []),
              NOTES.dates,
              NOTES.timestamps,
            ],
          },
          ...(observations ? { observations } : {}),
          ...(coverage ? { coverage_intervals: coverage } : {}),
        };
        file = {
          fileName: `${baseName}.json`,
          contentType: "application/json; charset=utf-8",
          body: encoder.encode(`${JSON.stringify(document, null, 2)}\n`),
        };
      } else {
        const csvFiles: { name: string; data: Uint8Array }[] = [];
        if (observations) {
          csvFiles.push({ name: "observations.csv", data: encoder.encode(toCsv(OBSERVATION_COLUMNS, observations.map(observationCsvRow))) });
        }
        if (coverage) {
          csvFiles.push({ name: "coverage_intervals.csv", data: encoder.encode(toCsv(COVERAGE_COLUMNS, coverage)) });
        }
        file =
          csvFiles.length === 1
            ? { fileName: `${baseName}.csv`, contentType: "text/csv; charset=utf-8", body: csvFiles[0].data }
            : { fileName: `${baseName}.zip`, contentType: "application/zip", body: createZip(csvFiles, generatedAt) };
      }

      const sha256 = createHash("sha256").update(file.body).digest("hex");

      // No auth yet: exports are attributed to the researcher who created the study (the seed
      // researcher in the demo).
      await tx.insert(exports).values({
        id: exportId,
        studyId: study.id,
        requestedBy: study.createdBy,
        params,
        format: request.format,
        status: "ready",
        storageKey: null,
        sha256,
        createdAt: generatedAt,
      });
      await tx.insert(auditLog).values({
        actorType: "researcher",
        actorId: study.createdBy,
        action: "export",
        entity: "exports",
        entityId: exportId,
        metadata: {
          // Says the actor is not authenticated, so the trail doesn't claim the researcher asked.
          actor_basis: "placeholder_no_auth",
          study_id: study.id,
          study_code: study.code,
          format: request.format,
          ...params,
          row_counts: rowCounts,
          file_name: file.fileName,
          bytes: file.body.byteLength,
          sha256,
        },
        at: generatedAt,
      });

      return { exportId, ...file, sha256, rowCounts };
    },
    { isolationLevel: "repeatable read", accessMode: "read write" },
  );
}
