import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMapSpecification } from "../src/dota/map-spec.js";
import {
  assertSpatialAssertions,
  evaluateSpatialAssertions,
  minimumPathSeparation,
  minimumPathSeparationWitness,
} from "../src/dota/map-spatial.js";

test("spatial assertions measure entity distance and true polyline separation", () => {
  const contract = parseMapSpecification({
    requiredEntities: [],
    managedEntities: [
      { targetname: "tower", classname: "npc_dota_tower", origin: "0 0 128" },
      { targetname: "entrance", classname: "info_target", origin: "600 0 128" },
    ],
    managedPaths: [
      { name: "north", points: [[-1000, 512, 128], [1000, 512, 128]] },
      { name: "south", points: [[-1000, -512, 128], [1000, -512, 128]] },
    ],
    spatialAssertions: [
      { kind: "entityDistance", name: "tower_covers_entrance", from: "tower", to: "entrance", max: 700 },
      { kind: "pathSeparation", name: "waves_stay_apart", pathA: "north", pathB: "south", min: 1000 },
    ],
  });

  assert.deepEqual(evaluateSpatialAssertions(contract).map((result) => ({
    name: result.name,
    passed: result.passed,
    actualDistance: result.actualDistance,
  })), [
    { name: "tower_covers_entrance", passed: true, actualDistance: 600 },
    { name: "waves_stay_apart", passed: true, actualDistance: 1024 },
  ]);
  assert.doesNotThrow(() => assertSpatialAssertions(contract));
});

test("path separation checks segment interiors rather than waypoint pairs only", () => {
  const a = { name: "a", points: [[-512, -512, 128], [512, 512, 128]] };
  const b = { name: "b", points: [[-512, 512, 128], [512, -512, 128]] };
  const separation = minimumPathSeparation(
    a,
    b,
  );
  assert.equal(separation, 0);
  assert.deepEqual(minimumPathSeparationWitness(a, b), {
    distance: 0,
    points: [[0, 0], [0, 0]],
  });
});

test("violated spatial assertions fail before map reconciliation", () => {
  const contract = parseMapSpecification({
    requiredEntities: [],
    managedPaths: [
      { name: "north", points: [[-1000, 400, 128], [1000, 400, 128]] },
      { name: "south", points: [[-1000, -400, 128], [1000, -400, 128]] },
    ],
    spatialAssertions: [
      { kind: "pathSeparation", name: "waves_stay_apart", pathA: "north", pathB: "south", min: 1000 },
    ],
  });

  assert.throws(
    () => assertSpatialAssertions(contract),
    /waves_stay_apart.*800\.00.*minimum 1000/,
  );
});

test("spatial assertions reject unsafe limits, duplicate names, and missing references", () => {
  assert.throws(
    () => parseMapSpecification({
      requiredEntities: [],
      managedEntities: [
        { targetname: "a", classname: "info_target", origin: "0 0 128" },
        { targetname: "b", classname: "info_target", origin: "10 0 128" },
      ],
      spatialAssertions: [
        { kind: "entityDistance", name: "bad", from: "a", to: "b", min: 20, max: 10 },
      ],
    }),
    /min cannot exceed max/,
  );
  assert.throws(
    () => parseMapSpecification({
      requiredEntities: [],
      managedEntities: [
        { targetname: "a", classname: "info_target", origin: "0 0 128" },
      ],
      spatialAssertions: [
        { kind: "entityDistance", name: "same", from: "a", to: "missing", max: 10 },
        { kind: "entityDistance", name: "same", from: "a", to: "missing", max: 20 },
      ],
    }),
    /duplicate name/,
  );
  assert.throws(
    () => parseMapSpecification({
      requiredEntities: [],
      managedEntities: [
        { targetname: "a", classname: "info_target", origin: "0 0 128" },
      ],
      spatialAssertions: [
        { kind: "entityDistance", name: "missing_ref", from: "a", to: "missing", max: 10 },
      ],
    }),
    /Spatial assertion "missing_ref" is unresolved/,
  );
});

test("reusable component placement namespaces spatial assertion references", () => {
  const contract = parseMapSpecification({
    requiredEntities: [],
    components: {
      route_pair: {
        managedPaths: [
          { name: "north", points: [[-512, 512, 128], [512, 512, 128]] },
          { name: "south", points: [[-512, -512, 128], [512, -512, 128]] },
        ],
        spatialAssertions: [
          { kind: "pathSeparation", name: "spacing", pathA: "north", pathB: "south", min: 1000 },
        ],
      },
    },
    placements: [
      { component: "route_pair", name: "west", worldOffset: [-2048, 0, 0] },
      { component: "route_pair", name: "east", worldOffset: [2048, 0, 0], mirrorAxis: "x" },
    ],
  });

  assert.deepEqual(contract.spatialAssertions, [
    { kind: "pathSeparation", name: "west_spacing", pathA: "west_north", pathB: "west_south", min: 1000 },
    { kind: "pathSeparation", name: "east_spacing", pathA: "east_north", pathB: "east_south", min: 1000 },
  ]);
  assert.ok(evaluateSpatialAssertions(contract).every((result) => result.passed));
});
