import { test } from "node:test";
import assert from "node:assert/strict";
import { assessOfflineAcceptance } from "../src/dota/map-offline-acceptance.js";

const passingInput = {
  stageErrors: { sync: false, compile: false, validation: false, preview: false },
  sync: {
    changed: 0,
    currentSpatialAssertionSummary: { total: 6, passed: 6, failed: 0, unresolved: 0 },
    spatialAssertionSummary: { total: 6, passed: 6, failed: 0, unresolved: 0 },
  },
  compilePreflight: {
    dryRun: true,
    materialValidation: { safeToWrite: true },
    modelValidation: { safeToWrite: true },
    modelPhysicsValidation: null,
  },
  validation: { ok: true },
  preview: { stats: { overlays: { failedSpatialAssertions: 0 } } },
  previewProduced: true,
};

test("offline acceptance passes only when every no-engine criterion is proven", () => {
  assert.deepEqual(assessOfflineAcceptance(passingInput), {
    ok: true,
    criteria: {
      stagesSucceeded: true,
      contractIsSynchronized: true,
      currentSpatialRulesPass: true,
      desiredSpatialRulesPass: true,
      compilePreflightPasses: true,
      staticValidationPasses: true,
      previewSpatialRulesPass: true,
      previewProduced: true,
    },
  });
});

test("offline acceptance fails closed on drift, unresolved rules, stage errors, or missing evidence", () => {
  const drifted = structuredClone(passingInput);
  drifted.sync.changed = 2;
  drifted.sync.currentSpatialAssertionSummary = { total: 6, passed: 4, failed: 2, unresolved: 1 };
  drifted.stageErrors.preview = true;
  drifted.compilePreflight.modelValidation.safeToWrite = false;
  drifted.previewProduced = false;
  const result = assessOfflineAcceptance(drifted);
  assert.equal(result.ok, false);
  assert.equal(result.criteria.contractIsSynchronized, false);
  assert.equal(result.criteria.currentSpatialRulesPass, false);
  assert.equal(result.criteria.stagesSucceeded, false);
  assert.equal(result.criteria.compilePreflightPasses, false);
  assert.equal(result.criteria.previewProduced, false);

  const missing = assessOfflineAcceptance({
    stageErrors: { sync: false, compile: false, validation: false, preview: false },
    sync: {},
    compilePreflight: {},
    validation: {},
    preview: {},
    previewProduced: true,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.criteria.currentSpatialRulesPass, false);
  assert.equal(missing.criteria.desiredSpatialRulesPass, false);
  assert.equal(missing.criteria.compilePreflightPasses, false);
  assert.equal(missing.criteria.previewSpatialRulesPass, false);
});
