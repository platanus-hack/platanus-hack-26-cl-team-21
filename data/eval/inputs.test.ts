import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseEpisodes } from "./inputs";

describe("annotation inputs", () => {
  test("reads an annotation sheet exported as CSV, ignoring extra columns", () => {
    const { episodes } = parseEpisodes("start,end,kind,note\n2026-11-21T14:05:12-03:00,2026-11-21T14:12:08-03:00,meal,sandwich\n", "p-01-a.csv");
    assert.deepEqual(episodes, [{ start: Date.parse("2026-11-21T17:05:12Z"), end: Date.parse("2026-11-21T17:12:08Z") }]);
  });

  test("reads JSON with an annotator, or a bare array", () => {
    const row = { start: "2026-11-21T14:00:00-03:00", end: "2026-11-21T14:01:00-03:00" };
    assert.equal(parseEpisodes(JSON.stringify({ annotator: "A1", episodes: [row] }), "gt.json").annotator, "A1");
    assert.equal(parseEpisodes(JSON.stringify([row]), "gt.json").episodes.length, 1);
  });

  test("rejects times without an offset, backwards episodes and sheets without the columns", () => {
    assert.throws(() => parseEpisodes("start,end\n2026-11-21T14:00:00,2026-11-21T14:01:00\n", "a.csv"), /offset/);
    assert.throws(() => parseEpisodes("start,end\n2026-11-21T14:05:00Z,2026-11-21T14:01:00Z\n", "a.csv"), /after start/);
    assert.throws(() => parseEpisodes("from,to\n1,2\n", "a.csv"), /start and end/);
  });
});
