// Evaluates pipeline runs against annotated ground truth and prints a Markdown report (or JSON with --json).
//
//   npm run eval -- --truth data/annotations/p-01-a.csv [--truth ...] --upload <upload_id> [--run <run_id> [--run <run_id>]]
//   npm run eval -- --truth gt.json --predictions run1.json [--predictions run2.json] [--coverage coverage.json]
//
// `--upload` reads the runs, observations and coverage from DATABASE_URL (the latest succeeded run unless --run is given;
// give two runs to measure consistency). Several --truth files are independent annotators.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseEpisodes, parseTime } from "./inputs";
import { type CoverageInterval, DEFAULT_MIN_IOU, type Episode, agreement, evaluate, summarizeCoverage } from "./metrics";
import { agreementLine, coverageTable, evaluationTable, smallSampleNote } from "./report";

const { values } = parseArgs({
  options: {
    truth: { type: "string", multiple: true },
    upload: { type: "string" },
    run: { type: "string", multiple: true },
    predictions: { type: "string", multiple: true },
    coverage: { type: "string" },
    "min-iou": { type: "string" },
    json: { type: "boolean" },
  },
});

interface Source {
  label: string;
  episodes: Episode[];
}

async function fromDatabase(uploadId: string, runIds: string[]) {
  const db = await import("@observatorio/db");
  try {
    const [batch] = await db.db.select().from(db.syncBatches).where(db.eq(db.syncBatches.id, uploadId));
    if (!batch) throw new Error(`no upload ${uploadId}`);
    const runs = runIds.length
      ? runIds
      : (
          await db.db
            .select({ id: db.pipelineRuns.id })
            .from(db.pipelineRuns)
            .innerJoin(db.pipelineRunInputs, db.eq(db.pipelineRunInputs.runId, db.pipelineRuns.id))
            .where(db.and(db.eq(db.pipelineRunInputs.mediaAssetId, uploadId), db.eq(db.pipelineRuns.status, "succeeded")))
            .orderBy(db.sql`${db.pipelineRuns.startedAt} desc`)
            .limit(1)
        ).map((r) => r.id);
    if (runs.length === 0) throw new Error(`upload ${uploadId} has no succeeded pipeline run`);
    const sources: Source[] = [];
    for (const runId of runs) {
      const rows = await db.db.select().from(db.observations).where(db.eq(db.observations.pipelineRunId, runId));
      sources.push({ label: `run ${runId}`, episodes: rows.map((o) => ({ start: o.startedAt.getTime(), end: o.endedAt.getTime() })) });
    }
    const coverage: CoverageInterval[] = (await db.db.select().from(db.coverageIntervals).where(db.eq(db.coverageIntervals.batchId, uploadId))).map((c) => ({
      start: c.startedAt.getTime(),
      end: c.endedAt.getTime(),
      status: c.status,
    }));
    return { sources, coverage, span: { from: batch.recordedFrom.getTime(), to: batch.recordedTo.getTime() } };
  } finally {
    await db.db.$client.end();
  }
}

async function fromFiles(files: string[], coverageFile?: string) {
  const sources: Source[] = [];
  for (const file of files) sources.push({ label: path.basename(file), episodes: parseEpisodes(await readFile(file, "utf8"), file).episodes });
  let coverage: CoverageInterval[] = [];
  if (coverageFile) {
    const rows = JSON.parse(await readFile(coverageFile, "utf8")) as { start: string; end: string; status: string }[];
    coverage = rows.map((r) => ({ start: parseTime(r.start, coverageFile), end: parseTime(r.end, coverageFile), status: r.status }));
  }
  const all = [...coverage.flatMap((c) => [c.start, c.end]), ...sources.flatMap((s) => s.episodes.flatMap((e) => [e.start, e.end]))];
  return { sources, coverage, span: all.length ? { from: Math.min(...all), to: Math.max(...all) } : { from: 0, to: 0 } };
}

async function main() {
  if (!values.truth?.length) throw new Error("give at least one --truth annotation file (.csv or .json)");
  if (!values.upload && !values.predictions?.length) throw new Error("give --upload <upload_id> or --predictions <file>");
  const minIoU = values["min-iou"] ? Number(values["min-iou"]) : DEFAULT_MIN_IOU;
  if (!(minIoU > 0 && minIoU <= 1)) throw new Error("--min-iou must be in (0, 1]");

  const truths: Source[] = [];
  for (const file of values.truth) {
    const parsed = parseEpisodes(await readFile(file, "utf8"), file);
    truths.push({ label: parsed.annotator ?? path.basename(file, path.extname(file)), episodes: parsed.episodes });
  }
  const { sources, coverage, span } = values.upload ? await fromDatabase(values.upload, values.run ?? []) : await fromFiles(values.predictions!, values.coverage);
  const observed = coverage.length ? coverage.filter((c) => c.status === "observed") : undefined;
  const summary = coverage.length ? summarizeCoverage(coverage, span.from, span.to) : undefined;

  const results = sources.map((source) => ({
    prediction: source.label,
    againstAnnotator: truths.map((truth) => ({ annotator: truth.label, ...evaluate({ truth: truth.episodes, predicted: source.episodes, observed, minIoU }) })),
  }));
  const consistency = sources.length > 1 ? agreement(sources[0].episodes, sources[1].episodes, minIoU) : undefined;
  const annotatorAgreement = truths.length > 1 ? agreement(truths[0].episodes, truths[1].episodes, minIoU) : undefined;

  if (values.json) {
    console.log(JSON.stringify({ minIoU, coverage: summary, results, consistency, annotatorAgreement }, null, 2));
    return;
  }
  const out: string[] = [`# Evaluation`, "", `Episodes match when their time overlap (IoU) is at least ${minIoU}, one prediction per truth episode.`];
  if (summary) out.push("", "## Coverage", "", coverageTable(summary), "", "Truth episodes that are mostly outside observed time are set aside, not counted as misses.");
  else out.push("", "No coverage was given or found: every truth episode is judged, including any the pipeline could not have seen.");
  for (const result of results) {
    for (const r of result.againstAnnotator) {
      out.push("", `## ${result.prediction} vs annotator ${r.annotator}`, "", evaluationTable(r));
      const note = smallSampleNote(r.truth.evaluated);
      if (note) out.push("", note);
    }
  }
  if (consistency) out.push("", "## Consistency between the first two runs", "", agreementLine(consistency));
  if (annotatorAgreement) out.push("", "## Agreement between the first two annotators", "", agreementLine(annotatorAgreement));
  console.log(out.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
