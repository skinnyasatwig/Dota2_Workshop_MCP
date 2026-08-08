import { test } from "node:test";
import assert from "node:assert/strict";
import { assessOfflineAcceptance } from "../src/dota/map-offline-acceptance.js";
import {
  describeOfflineAcceptanceArtifact,
  verifyOfflineAcceptanceArtifact,
} from "../src/dota/map-offline-acceptance-artifacts.js";

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
  compileRequested: false,
  compileExecutionError: false,
  compileExecution: null,
  postCompileValidationError: false,
  postCompileValidation: null,
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
      compileExecutionPasses: true,
      postCompileValidationPasses: true,
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
    compileRequested: false,
    compileExecutionError: false,
    compileExecution: null,
    postCompileValidationError: false,
    postCompileValidation: null,
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

test("requested compilation requires a committed VPK and fresh post-compile validation", () => {
  const requested = structuredClone(passingInput);
  requested.compileRequested = true;
  requested.compileExecution = { ok: true, committed: true, rolledBack: false };
  requested.postCompileValidation = { ok: true, compiled: true, compiledFresh: true };
  assert.equal(assessOfflineAcceptance(requested).ok, true);

  requested.compileExecution = { ok: false, committed: false, rolledBack: true };
  requested.postCompileValidation = { ok: true, compiled: true, compiledFresh: true };
  let failed = assessOfflineAcceptance(requested);
  assert.equal(failed.ok, false);
  assert.equal(failed.criteria.compileExecutionPasses, false);

  requested.compileExecution = { ok: true, committed: true, rolledBack: false };
  requested.postCompileValidation = { ok: true, compiled: true, compiledFresh: false };
  failed = assessOfflineAcceptance(requested);
  assert.equal(failed.ok, false);
  assert.equal(failed.criteria.postCompileValidationPasses, false);
});

test("offline acceptance artifact fingerprints detect stale or corrupt preview bytes", () => {
  const preview = Buffer.from("deterministic preview bytes");
  const integrity = describeOfflineAcceptanceArtifact(preview);
  assert.equal(integrity.algorithm, "sha256");
  assert.equal(integrity.byteLength, preview.byteLength);
  assert.match(integrity.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(verifyOfflineAcceptanceArtifact(preview, integrity), {
    ok: true,
    actual: integrity,
    findings: [],
  });

  const changed = verifyOfflineAcceptanceArtifact(Buffer.from("changed preview bytes"), integrity);
  assert.equal(changed.ok, false);
  assert.equal(changed.findings.some((finding) => finding.includes("byte length differs")), true);
  assert.equal(changed.findings.some((finding) => finding.includes("SHA-256 differs")), true);
  assert.equal(verifyOfflineAcceptanceArtifact(preview, null).ok, false);
});
