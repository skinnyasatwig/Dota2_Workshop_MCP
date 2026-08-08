import { test } from "node:test";
import assert from "node:assert/strict";
import { assessOfflineAcceptance } from "../src/dota/map-offline-acceptance.js";
import {
  describeOfflineAcceptanceArtifact,
  verifyOfflineAcceptanceArtifact,
} from "../src/dota/map-offline-acceptance-artifacts.js";
import {
  captureOfflineAcceptanceMetrics,
  compareOfflineAcceptanceMetrics,
} from "../src/dota/map-offline-acceptance-comparison.js";

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

const comparisonReport = {
  ok: true,
  stages: {
    validation: {
      structuredContent: {
        entityCount: 165,
        requirementCount: 148,
        findings: [{ severity: "warn" }],
        reachability: {
          walkableCellCount: 3619,
          reachableCellCount: 3235,
          unreachableCellCount: 384,
          holeCellCount: 0,
          regionCount: 2,
        },
      },
    },
    preview: {
      structuredContent: {
        stats: {
          waterCells: 564,
          cliffCells: 469,
          rampCells: 127,
          overlays: {
            entities: 94,
            paths: 60,
            towers: 10,
            camps: 18,
            objectives: 16,
            spatialAssertions: 6,
            failedSpatialAssertions: 0,
          },
        },
      },
    },
  },
};

test("offline acceptance metric comparison stays quiet for an unchanged coherent run", () => {
  const captured = captureOfflineAcceptanceMetrics(comparisonReport);
  assert.equal(captured.ok, true);
  assert.ok(captured.snapshot);
  const comparison = compareOfflineAcceptanceMetrics(captured.snapshot, structuredClone(captured.snapshot));
  assert.deepEqual(comparison.changedMetrics, []);
  assert.deepEqual(comparison.attentionSignals, []);
  assert.equal(comparison.requiresReview, false);
});

test("offline acceptance metric comparison flags risky deltas without rejecting design changes", () => {
  const before = captureOfflineAcceptanceMetrics(comparisonReport).snapshot!;
  const changedReport = structuredClone(comparisonReport);
  changedReport.ok = false;
  changedReport.stages.validation.structuredContent.findings.push({ severity: "error" });
  changedReport.stages.validation.structuredContent.reachability.reachableCellCount = 3100;
  changedReport.stages.validation.structuredContent.reachability.unreachableCellCount = 519;
  changedReport.stages.validation.structuredContent.reachability.holeCellCount = 4;
  changedReport.stages.preview.structuredContent.stats.overlays.towers = 8;
  const after = captureOfflineAcceptanceMetrics(changedReport).snapshot!;
  const comparison = compareOfflineAcceptanceMetrics(before, after);
  assert.equal(comparison.requiresReview, true);
  assert.equal(comparison.acceptanceChanged, true);
  assert.equal(comparison.changedMetrics.some((delta) => delta.metric === "holeCells" && delta.delta === 4), true);
  assert.equal(comparison.attentionSignals.some((signal) => signal.includes("pass to fail")), true);
  assert.equal(comparison.attentionSignals.some((signal) => signal.includes("Unreachable cells")), true);
  assert.equal(comparison.attentionSignals.some((signal) => signal.includes("Tower overlays")), true);
});

test("offline acceptance metric capture fails closed when evidence is incomplete", () => {
  const captured = captureOfflineAcceptanceMetrics({ ok: true, stages: {} });
  assert.equal(captured.ok, false);
  assert.equal(captured.snapshot, null);
  assert.equal(captured.findings.length > 10, true);
});
