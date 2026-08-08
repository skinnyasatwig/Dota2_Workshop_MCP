import { test } from "node:test";
import assert from "node:assert/strict";
import { processListContains } from "../src/dota/process.js";
import { waitForProcessStart } from "../src/dota/game-session.js";

test("task-list detection matches only the requested process row", () => {
  const output = [
    "dota2.exe                 4120 Console                    1  3,250,000 K",
    "steam.exe                 2200 Console                    1    250,000 K",
  ].join("\n");
  assert.equal(processListContains(output, "dota2.exe"), true);
  assert.equal(processListContains(output, "hammer.exe"), false);
  assert.equal(processListContains("INFO: No tasks are running which match the specified criteria.", "dota2.exe"), false);
});

test("Steam launch process polling succeeds when Dota appears", async () => {
  const samples = [false, false, true];
  let pauses = 0;
  const started = await waitForProcessStart(
    "dota2.exe",
    1500,
    500,
    async () => samples.shift() ?? false,
    async () => {
      pauses += 1;
    },
  );
  assert.equal(started, true);
  assert.equal(pauses, 2);
});

test("Steam launch process polling fails after its bounded attempts", async () => {
  let checks = 0;
  const started = await waitForProcessStart(
    "dota2.exe",
    1000,
    250,
    async () => {
      checks += 1;
      return false;
    },
    async () => undefined,
  );
  assert.equal(started, false);
  assert.equal(checks, 4);
});
