import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectStaticPropPaletteInstallation,
  STATIC_PROP_PALETTES,
  STATIC_PROP_PALETTE_IDS,
  staticPropPaletteVariant,
  validateStaticPropPaletteLibrary,
} from "../src/dota/static-prop-palettes.js";

test("curated static-prop palettes are internally valid and visual-only", () => {
  assert.deepEqual(validateStaticPropPaletteLibrary(), []);
  assert.equal(STATIC_PROP_PALETTE_IDS.length, 5);
  assert.equal(
    Object.values(STATIC_PROP_PALETTES).flatMap((palette) => Object.values(palette.variants)).length,
    20,
  );
  assert.ok(Object.values(STATIC_PROP_PALETTES).every((palette) => palette.collision === "none"));
  assert.equal(
    staticPropPaletteVariant("river-wetland", "lily-pads")?.model,
    "models/props_nature/lily_pads001.vmdl",
  );
  assert.equal(staticPropPaletteVariant("river-wetland", "missing"), undefined);
});

test("palette installation reports exact compiled-resource coverage", () => {
  const compiled = new Set(
    Object.values(STATIC_PROP_PALETTES)
      .flatMap((palette) => Object.values(palette.variants))
      .map((variant) => `${variant.model}_c`.toUpperCase()),
  );
  const complete = inspectStaticPropPaletteInstallation(compiled);
  assert.equal(complete.complete, true);
  assert.equal(complete.modelCount, 20);
  assert.equal(complete.installedCount, 20);
  assert.deepEqual(complete.missing, []);
  assert.equal(complete.visualBoundsVerified, false);
  assert.equal(complete.currentVisualBoundsCount, null);

  compiled.delete("MODELS/PROPS_NATURE/LILY_PADS001.VMDL_C");
  const incomplete = inspectStaticPropPaletteInstallation(compiled);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.installedCount, 19);
  assert.deepEqual(incomplete.missing, ["models/props_nature/lily_pads001.vmdl"]);
  assert.equal(
    incomplete.palettes.find((palette) => palette.id === "river-wetland")?.complete,
    false,
  );
});

test("palette installation proves visual-bound freshness with VPK CRCs", () => {
  const compiled = new Map(
    Object.values(STATIC_PROP_PALETTES)
      .flatMap((palette) => Object.values(palette.variants))
      .map((variant) => [`${variant.model}_c`.toUpperCase(), { crc: variant.compiledCrc }]),
  );
  const complete = inspectStaticPropPaletteInstallation(compiled);
  assert.equal(complete.visualBoundsVerified, true);
  assert.equal(complete.currentVisualBoundsCount, 20);
  assert.deepEqual(complete.staleVisualBounds, []);

  compiled.set("MODELS/PROPS_NATURE/LILY_PADS001.VMDL_C", { crc: 123 });
  const stale = inspectStaticPropPaletteInstallation(compiled);
  assert.equal(stale.complete, true);
  assert.equal(stale.currentVisualBoundsCount, 19);
  assert.deepEqual(stale.staleVisualBounds, [{
    model: "models/props_nature/lily_pads001.vmdl",
    expectedCrc: 1867346537,
    installedCrc: 123,
  }]);
});
