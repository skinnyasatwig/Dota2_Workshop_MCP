import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  extractMapModelReferences,
  inspectMapModels,
} from "../src/dota/map-model.js";

const MAP_TEXT = `
  "models/props_debris/rock_debris001.vmdl"
  "models\\props_debris\\rock_debris001.vmdl"
  "models/custom/source_only.vmdl"
  "models/custom/compiled.vmdl"
  "models/missing/not_here.vmdl"
  "models/../escape.vmdl"
`;

test("VMAP model references are extracted and slash-normalized", () => {
  assert.deepEqual(extractMapModelReferences(MAP_TEXT), [
    "models/props_debris/rock_debris001.vmdl",
    "models/props_debris/rock_debris001.vmdl",
    "models/custom/source_only.vmdl",
    "models/custom/compiled.vmdl",
    "models/missing/not_here.vmdl",
    "models/../escape.vmdl",
  ]);
});

test("map models resolve across source, compiled, and packed assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-map-model-"));
  const content = join(root, "content");
  const game = join(root, "game");
  try {
    const sourceOnly = join(content, "models", "custom", "source_only.vmdl");
    const compiled = join(game, "models", "custom", "compiled.vmdl_c");
    await Promise.all([
      mkdir(dirname(sourceOnly), { recursive: true }),
      mkdir(dirname(compiled), { recursive: true }),
    ]);
    await Promise.all([writeFile(sourceOnly, "source"), writeFile(compiled, "compiled")]);

    const report = await inspectMapModels({
      mapText: MAP_TEXT,
      sourceRoots: [content],
      compiledRoots: [game],
      packedResources: [{
        label: "base fixture",
        entries: new Map([["models/props_debris/rock_debris001.vmdl_c", {}]]),
      }],
    });
    assert.equal(report.referenceCount, 6);
    assert.equal(report.uniqueModelCount, 5);
    assert.equal(report.resolvedCount, 2);
    assert.equal(report.sourceOnlyCount, 1);
    assert.equal(report.missingCount, 1);
    assert.equal(report.invalidCount, 1);
    assert.equal(report.safeToWrite, false);
    assert.equal(report.compiledReady, false);
    assert.deepEqual(
      report.models.find((model) => model.model === "models/props_debris/rock_debris001.vmdl")?.packages,
      ["base fixture"],
    );
    assert.deepEqual(report.findings.map((finding) => [finding.severity, finding.code]), [
      ["error", "map-model-path-invalid"],
      ["warn", "map-model-compiled-missing"],
      ["error", "map-model-missing"],
    ]);

    const strict = await inspectMapModels({
      mapText: `"models/custom/source_only.vmdl"`,
      sourceRoots: [content],
      compiledRoots: [game],
      requireCompiledAssets: true,
    });
    assert.equal(strict.safeToWrite, false);
    assert.deepEqual(strict.findings.map((finding) => [finding.severity, finding.code]), [
      ["error", "map-model-compiled-missing"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unreadable package evidence is retained without hiding a resolved loose model", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-map-model-warning-"));
  try {
    const compiled = join(root, "models", "custom", "ready.vmdl_c");
    await mkdir(dirname(compiled), { recursive: true });
    await writeFile(compiled, "compiled");
    const report = await inspectMapModels({
      mapText: `"models/custom/ready.vmdl"`,
      compiledRoots: [root],
      packageFindings: [{
        severity: "warn",
        code: "map-model-package-unreadable",
        detail: "fixture package could not be opened",
      }],
    });
    assert.equal(report.safeToWrite, true);
    assert.equal(report.compiledReady, true);
    assert.equal(report.resolvedCount, 1);
    assert.equal(report.findings[0]?.code, "map-model-package-unreadable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
