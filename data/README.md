# data

Interchange schemas (`schemas/`) and the evaluation of the pipeline (`eval/`).

## Evaluation (AGENTS.md §6)

A volunteer wears the pendant through a scripted session. Independent annotators label the eating and drinking episodes from the script or the full footage, and `eval` scores a pipeline run against each annotator: precision, recall, F1, count error, start and end time error, and coverage. It also compares two runs of the same session (consistency) and two annotators (how much the humans agree, which is the ceiling for any model).

### The annotation sheet

One file per annotator, either a CSV (what a spreadsheet exports) or JSON ([`schemas/ground-truth.schema.json`](./schemas/ground-truth.schema.json)):

```csv
start,end,kind,note
2026-11-21T14:05:12-03:00,2026-11-21T14:12:08-03:00,meal,sandwich and water
2026-11-21T14:40:00-03:00,2026-11-21T14:41:30-03:00,drink,
```

- Times are ISO 8601 **with an offset**; a time without one is rejected.
- Annotate every episode you see, including ones during the privacy switch or in an excluded clip, so the sheet is the real script. The evaluation sets aside the episodes the pipeline could not have seen (mostly outside the observed coverage) instead of counting them as misses.
- Don't annotate handling food without eating, or other distractors: they are exactly what the pipeline must not report.

### Run it

```bash
# A run stored in the database (the latest succeeded one, or pick with --run; two --run flags measure consistency)
npm run eval -- --truth annotations/a-01.csv --truth annotations/a-02.csv --upload <upload_id>

# Or from files, e.g. an export of predictions and coverage
npm run eval -- --truth gt.json --predictions run1.json --predictions run2.json --coverage coverage.json

# Options: --min-iou 0.5 (how much two episodes must overlap to be the same one), --json
```

- Episodes match one-to-one by time overlap (IoU, at least 0.5 by default); a split prediction counts one hit and one false positive.
- A rate that can't be computed (no predictions, no judged truth) prints `n/a`, never 0.
- With fewer than 10 judged truth episodes the report says the rates are not stable estimates. A demo session has few episodes: report the counts.

`npm run eval:test` runs the tests of the metrics (no database needed).
