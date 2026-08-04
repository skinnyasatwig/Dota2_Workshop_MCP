import { test } from "node:test";
import assert from "node:assert/strict";
import { processListContains } from "../src/dota/process.js";

test("task-list detection matches only the requested process row", () => {
  const output = [
    "dota2.exe                 4120 Console                    1  3,250,000 K",
    "steam.exe                 2200 Console                    1    250,000 K",
  ].join("\n");
  assert.equal(processListContains(output, "dota2.exe"), true);
  assert.equal(processListContains(output, "hammer.exe"), false);
  assert.equal(processListContains("INFO: No tasks are running which match the specified criteria.", "dota2.exe"), false);
});
