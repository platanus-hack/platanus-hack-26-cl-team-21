import assert from "node:assert/strict";
import { test } from "node:test";
import { errorResponse } from "./errors";

test("returns a generic 500 without logging query parameters", async (t) => {
  const log = t.mock.method(console, "error", () => {});
  const secret = "active-enrollment-code";
  const error = new Error(`Failed query: UPDATE participants\nparams: ${secret}`);

  const response = errorResponse(error);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: "internal_error", message: "Unexpected error" } });
  assert.deepEqual(log.mock.calls.map(({ arguments: args }) => args), [["Unexpected participant API error"]]);
});
