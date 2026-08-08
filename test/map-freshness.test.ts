import { test } from "node:test";
import assert from "node:assert/strict";
import { compareMapArtifactTimes } from "../src/dota/map-freshness.js";

test("compiled map is fresh when it is newer than the source", () => {
  const result = compareMapArtifactTimes(1_000, 1_250);
  assert.equal(result.fresh, true);
  assert.equal(result.ageDeltaMs, 250);
});

test("compiled map is fresh when timestamps are equal", () => {
  assert.equal(compareMapArtifactTimes(1_000, 1_000).fresh, true);
});

test("compiled map is stale when the source is newer", () => {
  const result = compareMapArtifactTimes(1_500, 1_000);
  assert.equal(result.fresh, false);
  assert.equal(result.ageDeltaMs, -500);
});
