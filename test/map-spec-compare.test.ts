import { test } from "node:test";
import assert from "node:assert/strict";
import { compareMapSpecifications } from "../src/dota/map-spec-compare.js";
import { parseMapSpecification } from "../src/dota/map-spec.js";

test("semantic comparison treats a flat team pair and nested reusable team placement as exact", () => {
  const baseline = parseMapSpecification({
    map: "arena",
    requiredEntities: [
      { targetname: "dire_t1", classname: "npc_dota_tower" },
      { targetname: "radiant_t1", classname: "npc_dota_tower" },
    ],
    dotaComponents: [
      {
        kind: "tower",
        name: "radiant_t1",
        team: "radiant",
        origin: [-2048, 0, 128],
        tier: 1,
        lane: "mid",
      },
      {
        kind: "tower",
        name: "dire_t1",
        team: "dire",
        origin: [2048, 0, 128],
        yaw: 180,
        tier: 1,
        lane: "mid",
      },
    ],
  });
  const candidate = parseMapSpecification({
    map: "arena",
    requiredEntities: [
      { targetname: "radiant_core_t1", classname: "npc_dota_tower" },
      { targetname: "dire_core_t1", classname: "npc_dota_tower" },
    ],
    components: {
      side: {
        dotaComponents: [{
          kind: "tower",
          name: "t1",
          team: "radiant",
          origin: [-2048, 0, 128],
          tier: 1,
          lane: "mid",
        }],
      },
      complete_side: {
        placements: [{ component: "side", name: "core" }],
      },
    },
    placements: [
      { component: "complete_side", name: "radiant" },
      { component: "complete_side", name: "dire", mirrorAxis: "x", teamSwap: true },
    ],
  });

  // The intermediate "core" namespace is intentional, so compare a flat contract
  // with the exact names produced by the composed version.
  baseline.managedEntities = baseline.managedEntities?.map((entity) => ({
    ...entity,
    targetname: entity.targetname.replace(/^(radiant|dire)_/, "$1_core_"),
  }));
  baseline.requiredEntities = baseline.requiredEntities.map((entity) => ({
    ...entity,
    targetname: entity.targetname.replace(/^(radiant|dire)_/, "$1_core_"),
  }));

  const report = compareMapSpecifications(baseline, candidate);
  assert.equal(report.equivalent, true);
  assert.equal(report.exactEquivalent, true);
  assert.equal(report.differenceCount, 0);
  assert.equal(report.families.managedEntities.unchangedCount, 2);
  assert.equal(report.families.requiredEntities.unchangedCount, 2);
});

test("comparison is order-insensitive for named objects and normalizes vector formatting", () => {
  const baseline = parseMapSpecification({
    managedEntities: [
      {
        targetname: "a",
        classname: "info_target",
        origin: "0 0 0",
        angles: "0 0 0",
        scales: "0.5 1 2",
      },
      { targetname: "b", classname: "info_target", origin: "1 2 3" },
    ],
    managedAbsentEntities: [
      { targetname: "old_b", classname: "info_target" },
      { targetname: "old_a", classname: "info_target" },
    ],
  });
  const candidate = parseMapSpecification({
    managedEntities: [
      { targetname: "b", classname: "info_target", origin: "1.0 2.00 3.000" },
      {
        targetname: "a",
        classname: "info_target",
        origin: "0.0 0 0",
        angles: "0 0.00 0",
        scales: "0.50 1.0 2.000",
      },
    ],
    managedAbsentEntities: [
      { targetname: "old_a", classname: "info_target" },
      { targetname: "old_b", classname: "info_target" },
    ],
  });

  const report = compareMapSpecifications(baseline, candidate);
  assert.equal(report.equivalent, true);
  assert.equal(report.exactEquivalent, true);
  assert.equal(report.families.managedEntities.unchangedCount, 2);
  assert.equal(report.families.managedAbsentEntities.unchangedCount, 2);
});

test("numeric tolerance is explicit and reports otherwise hidden drift", () => {
  const solid = (yaw: number) => parseMapSpecification({
    managedSolids: [{
      targetname: "wall",
      center: [0, 0, 128],
      yaw,
      material: "materials/dev/reflectivity_30.vmat",
      extrusion: {
        points: [[-128, -64], [128, -64], [128, 64], [-128, 64]],
        height: 256,
      },
    }],
  });
  const baseline = solid(146.30993247402023);
  const candidate = solid(146.309932);

  const tolerant = compareMapSpecifications(baseline, candidate, { numericTolerance: 0.000001 });
  assert.equal(tolerant.equivalent, true);
  assert.equal(tolerant.exactEquivalent, false);
  assert.equal(tolerant.toleratedNumericDriftCount, 1);
  assert.ok(tolerant.maximumToleratedNumericDrift < 0.000001);
  assert.equal(tolerant.toleratedNumericDrift[0].path, 'managedSolids["wall"].yaw');

  const strict = compareMapSpecifications(baseline, candidate);
  assert.equal(strict.equivalent, false);
  assert.equal(strict.families.managedSolids.changedCount, 1);
  assert.equal(strict.families.managedSolids.changed[0].fieldDifferenceCount, 1);
  assert.equal(strict.families.managedSolids.changed[0].differences[0].path, 'managedSolids["wall"].yaw');
});

test("comparison reports map, named-object, and ordered-terrain changes deterministically", () => {
  const baseline = parseMapSpecification({
    map: "old_map",
    managedEntities: [
      {
        targetname: "changed",
        classname: "info_target",
        origin: "0 0 0",
        properties: { mode: "old" },
      },
      { targetname: "removed", classname: "info_target", origin: "0 0 0" },
    ],
    managedTerrain: [
      { op: "height", level: 1, shape: { kind: "rect", x0: 0, y0: 0, x1: 2, y1: 2 } },
    ],
  });
  const candidate = parseMapSpecification({
    map: "new_map",
    managedEntities: [
      {
        targetname: "changed",
        classname: "info_target",
        origin: "0 0 0",
        properties: { mode: "new" },
      },
      { targetname: "added", classname: "info_target", origin: "0 0 0" },
    ],
    managedTerrain: [
      { op: "height", level: 2, shape: { kind: "rect", x0: 0, y0: 0, x1: 2, y1: 2 } },
    ],
  });

  const report = compareMapSpecifications(baseline, candidate);
  assert.equal(report.equivalent, false);
  assert.deepEqual(report.map, { baseline: "old_map", candidate: "new_map", equivalent: false });
  assert.deepEqual(report.families.managedEntities.added, ["added"]);
  assert.deepEqual(report.families.managedEntities.removed, ["removed"]);
  assert.equal(report.families.managedEntities.changed[0].key, "changed");
  assert.equal(
    report.families.managedEntities.changed[0].differences[0].path,
    'managedEntities["changed"].properties.mode',
  );
  assert.equal(report.families.managedTerrain.changed[0].key, "000000");
  assert.equal(
    report.families.managedTerrain.changed[0].differences[0].path,
    'managedTerrain["000000"].level',
  );
  assert.equal(report.differenceCount, 5);
  assert.equal(report.fieldDifferenceCount, 3);
});

test("difference detail is bounded without hiding aggregate counts", () => {
  const baseline = parseMapSpecification({
    managedEntities: Array.from({ length: 5 }, (_unused, index) => ({
      targetname: `old_${index}`,
      classname: "info_target",
      origin: "0 0 0",
    })),
  });
  const candidate = parseMapSpecification({
    managedEntities: Array.from({ length: 5 }, (_unused, index) => ({
      targetname: `new_${index}`,
      classname: "info_target",
      origin: "0 0 0",
    })),
  });

  const report = compareMapSpecifications(baseline, candidate, { maxDifferences: 2 });
  assert.equal(report.differenceCount, 10);
  assert.equal(report.families.managedEntities.addedCount, 5);
  assert.equal(report.families.managedEntities.removedCount, 5);
  assert.deepEqual(report.families.managedEntities.added, ["new_0", "new_1"]);
  assert.deepEqual(report.families.managedEntities.removed, ["old_0", "old_1"]);
  assert.equal(report.truncated, true);
});

test("semantic comparison includes named spatial assertions", () => {
  const specification = (minimum: number) => parseMapSpecification({
    requiredEntities: [],
    managedPaths: [
      { name: "north", points: [[-512, 512, 128], [512, 512, 128]] },
      { name: "south", points: [[-512, -512, 128], [512, -512, 128]] },
    ],
    spatialAssertions: [
      { kind: "pathSeparation", name: "wave_spacing", pathA: "north", pathB: "south", min: minimum },
    ],
  });
  const report = compareMapSpecifications(specification(1000), specification(900));

  assert.equal(report.equivalent, false);
  assert.equal(report.families.spatialAssertions.changedCount, 1);
  assert.equal(
    report.families.spatialAssertions.changed[0].differences[0].path,
    'spatialAssertions["wave_spacing"].min',
  );
});
