import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCuratedVisualPropFootprints,
  resolveProjectCuratedVisualPropFootprints,
} from "../src/dota/map-visual-props.js";
import { STATIC_PROP_PALETTES } from "../src/dota/static-prop-palettes.js";
import { ANIMATED_PROP_RECIPES } from "../src/dota/animated-prop-recipes.js";
import { ParsedMapEntity } from "../src/dota/vmap.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const bush = STATIC_PROP_PALETTES["radiant-underbrush"].variants["bush-round"];

function entity(overrides: Partial<ParsedMapEntity> = {}): ParsedMapEntity {
  return {
    classname: "prop_static",
    targetname: "preview_bush",
    origin: "100 200 10",
    angles: "0 90 0",
    scales: "2 1 1",
    properties: { model: bush.model, solid: "0" },
    ...overrides,
  };
}

test("curated visual props project CRC-current render bounds without becoming collision", () => {
  const report = resolveCuratedVisualPropFootprints(
    [entity()],
    new Map([[`${bush.model}_c`, { crc: bush.compiledCrc }]]),
  );
  assert.equal(report.matchedEntityCount, 1);
  assert.equal(report.footprintCount, 1);
  assert.equal(report.staleModelCount, 0);
  assert.equal(report.shadowedModelCount, 0);
  assert.equal(report.footprints[0].source, "crc-matched-render-bounds");
  assert.equal(report.footprints[0].palette, "radiant-underbrush");
  assert.equal(report.footprints[0].variant, "bush-round");
  assert.equal(report.footprints[0].points.length, 4);
  assert.ok(report.footprints[0].points.every((point) => point.every(Number.isFinite)));
});

test("checked animated props reuse CRC-current visual bounds without entering pathing", () => {
  const banner = ANIMATED_PROP_RECIPES["radiant-team-banner"];
  const report = resolveCuratedVisualPropFootprints([entity({
    classname: "prop_dynamic",
    targetname: "preview_banner",
    properties: {
      model: banner.model,
      solid: "0",
      StartingAnim: "banner_radiant_idle2",
    },
  })], new Map([[`${banner.model}_c`, { crc: banner.compiledCrc }]]));
  assert.equal(report.matchedEntityCount, 1);
  assert.equal(report.footprintCount, 1);
  assert.equal(report.footprints[0].family, "animated-recipe");
  assert.equal(report.footprints[0].recipe, "radiant-team-banner");
  assert.equal(report.footprints[0].sequence, "banner_radiant_idle2");
  assert.equal(report.footprints[0].palette, undefined);
});

test("curated visual props fail closed on stale bounds and malformed transforms", () => {
  const stale = resolveCuratedVisualPropFootprints(
    [entity()],
    new Map([[`${bush.model}_c`, { crc: 123 }]]),
  );
  assert.equal(stale.footprintCount, 0);
  assert.equal(stale.staleModelCount, 1);
  assert.equal(stale.staleModels[0].expectedCrc, bush.compiledCrc);

  const missing = resolveCuratedVisualPropFootprints([entity()], new Map());
  assert.equal(missing.footprintCount, 0);
  assert.equal(missing.staleModelCount, 1);
  assert.equal(missing.staleModels[0].installedCrc, null);

  const malformed = resolveCuratedVisualPropFootprints(
    [entity({ scales: "0 1 1" })],
    new Map([[`${bush.model}_c`, { crc: bush.compiledCrc }]]),
  );
  assert.equal(malformed.footprintCount, 0);
  assert.deepEqual(malformed.malformedEntities, ["preview_bush"]);

  const shadowed = resolveCuratedVisualPropFootprints(
    [entity()],
    new Map([[`${bush.model}_c`, { crc: bush.compiledCrc }]]),
    { shadowedModels: new Set([bush.model.toLowerCase()]) },
  );
  assert.equal(shadowed.footprintCount, 0);
  assert.equal(shadowed.shadowedModelCount, 1);
  assert.deepEqual(shadowed.shadowedModels, [bush.model]);
});

test("project visual props suppress a loose addon model that shadows Valve", async (context) => {
  const addonGame = await mkdtemp(join(tmpdir(), "dota-mcp-visual-shadow-"));
  context.after(() => rm(addonGame, { recursive: true, force: true }));
  const compiled = join(addonGame, `${bush.model}_c`);
  await mkdir(dirname(compiled), { recursive: true });
  await writeFile(compiled, "addon override");
  const report = await resolveProjectCuratedVisualPropFootprints(
    [entity()],
    new Map([[`${bush.model}_c`, { crc: bush.compiledCrc }]]),
    addonGame,
  );
  assert.equal(report.footprintCount, 0);
  assert.equal(report.shadowedModelCount, 1);
  assert.deepEqual(report.shadowedModels, [bush.model]);

  await rm(compiled, { force: true });
  await writeFile(join(addonGame, "pak01_dir.vpk"), "not a VPK");
  const unreadablePackage = await resolveProjectCuratedVisualPropFootprints(
    [entity()],
    new Map([[`${bush.model}_c`, { crc: bush.compiledCrc }]]),
    addonGame,
  );
  assert.equal(unreadablePackage.footprintCount, 0);
  assert.equal(unreadablePackage.shadowedModelCount, 1);
  assert.equal(unreadablePackage.shadowingWarnings.length, 1);
});
