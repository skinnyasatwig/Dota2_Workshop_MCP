import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  extractMapMaterialReferences,
  inspectMapMaterials,
} from "../src/dota/map-material.js";

const MAP_TEXT = `
  "materials/dev/reflectivity_30.vmat"
  "materials\\dev\\reflectivity_30.vmat"
  "materials/custom/source_only.vmat"
  "materials/custom/compiled.vmat"
  "materials/missing/not_here.vmat"
  "materials/../escape.vmat"
`;

test("VMAP material references are extracted and slash-normalized", () => {
  assert.deepEqual(extractMapMaterialReferences(MAP_TEXT), [
    "materials/dev/reflectivity_30.vmat",
    "materials/dev/reflectivity_30.vmat",
    "materials/custom/source_only.vmat",
    "materials/custom/compiled.vmat",
    "materials/missing/not_here.vmat",
    "materials/../escape.vmat",
  ]);
});

test("map materials resolve across source, compiled, and packed assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-map-material-"));
  const content = join(root, "content");
  const game = join(root, "game");
  try {
    const sourceOnly = join(content, "materials", "custom", "source_only.vmat");
    const compiled = join(game, "materials", "custom", "compiled.vmat_c");
    await Promise.all([
      mkdir(dirname(sourceOnly), { recursive: true }),
      mkdir(dirname(compiled), { recursive: true }),
    ]);
    await Promise.all([writeFile(sourceOnly, "source"), writeFile(compiled, "compiled")]);

    const report = await inspectMapMaterials({
      mapText: MAP_TEXT,
      sourceRoots: [content],
      compiledRoots: [game],
      packedResources: [{
        label: "base fixture",
        entries: new Map([["materials/dev/reflectivity_30.vmat_c", {}]]),
      }],
    });
    assert.equal(report.referenceCount, 6);
    assert.equal(report.uniqueMaterialCount, 5);
    assert.equal(report.resolvedCount, 2);
    assert.equal(report.sourceOnlyCount, 1);
    assert.equal(report.missingCount, 1);
    assert.equal(report.invalidCount, 1);
    assert.equal(report.safeToWrite, false);
    assert.equal(report.compiledReady, false);
    assert.deepEqual(
      report.materials.find((material) => material.material === "materials/dev/reflectivity_30.vmat")?.packages,
      ["base fixture"],
    );
    assert.deepEqual(report.findings.map((finding) => [finding.severity, finding.code]), [
      ["error", "map-material-path-invalid"],
      ["warn", "map-material-compiled-missing"],
      ["error", "map-material-missing"],
    ]);

    const strict = await inspectMapMaterials({
      mapText: `"materials/custom/source_only.vmat"`,
      sourceRoots: [content],
      compiledRoots: [game],
      requireCompiledAssets: true,
    });
    assert.equal(strict.safeToWrite, false);
    assert.deepEqual(strict.findings.map((finding) => [finding.severity, finding.code]), [
      ["error", "map-material-compiled-missing"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unreadable package evidence is retained without hiding a resolved loose material", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-map-material-warning-"));
  try {
    const compiled = join(root, "materials", "custom", "ready.vmat_c");
    await mkdir(dirname(compiled), { recursive: true });
    await writeFile(compiled, "compiled");
    const report = await inspectMapMaterials({
      mapText: `"materials/custom/ready.vmat"`,
      compiledRoots: [root],
      packageFindings: [{
        severity: "warn",
        code: "map-material-package-unreadable",
        detail: "fixture package could not be opened",
      }],
    });
    assert.equal(report.safeToWrite, true);
    assert.equal(report.compiledReady, true);
    assert.equal(report.resolvedCount, 1);
    assert.equal(report.findings[0]?.code, "map-material-package-unreadable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
