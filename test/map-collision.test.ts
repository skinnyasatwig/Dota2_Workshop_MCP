import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectMapCollisionObstacles,
  distanceToSegment2d,
  DOTA_OBSTRUCTION_BROAD_PHASE_RADIUS,
  physicalObstacleContainsPoint,
  resolveMapCollisionObstacles,
  sourceAngleMatrix,
} from "../src/dota/map-collision.js";
import { ParsedMapEntity } from "../src/dota/vmap.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function entity(
  classname: string,
  targetname: string,
  properties: Record<string, string> = {},
): ParsedMapEntity {
  return {
    classname,
    targetname,
    origin: "256 512 128",
    properties: { classname, targetname, ...properties },
  };
}

test("collision inventory distinguishes known obstructions from unknown prop bounds", () => {
  const obstacles = collectMapCollisionObstacles([
    entity("ent_dota_tree", "tree"),
    entity("point_simple_obstruction", "blocker"),
    entity("prop_static", "statue", { solid: "6" }),
    entity("prop_dynamic", "ghost", { solid: "0" }),
    entity("prop_dynamic", "nav_ignored", { solid: "6", spawnflags: "512" }),
    entity("prop_dynamic", "collision_disabled", { solid: "6", spawnflags: "256" }),
  ]);

  assert.deepEqual(obstacles.map(({ id, kind, approximateRadius }) => ({
    id,
    kind,
    approximateRadius,
  })), [
    { id: "tree", kind: "tree", approximateRadius: DOTA_OBSTRUCTION_BROAD_PHASE_RADIUS },
    {
      id: "blocker",
      kind: "point-obstruction",
      approximateRadius: DOTA_OBSTRUCTION_BROAD_PHASE_RADIUS,
    },
    { id: "statue", kind: "solid-prop", approximateRadius: undefined },
  ]);
});

test("2D segment distance supports conservative route proximity checks", () => {
  assert.equal(distanceToSegment2d([5, 3], [0, 0], [10, 0]), 3);
  assert.equal(distanceToSegment2d([-3, 4], [0, 0], [10, 0]), 5);
  assert.equal(distanceToSegment2d([3, 4], [0, 0], [0, 0]), 5);
});

function assertMatrixNear(actual: number[][], expected: number[][]): void {
  for (const [row, expectedRow] of expected.entries()) {
    for (const [column, expectedValue] of expectedRow.entries()) {
      assert.ok(
        Math.abs(actual[row][column] - expectedValue) < 1e-9,
        `matrix[${row}][${column}] expected ${expectedValue}, got ${actual[row][column]}`,
      );
    }
  }
}

function assertPointsNear(
  actual: readonly [number, number][],
  expected: readonly [number, number][],
): void {
  assert.equal(actual.length, expected.length);
  for (const [index, expectedPoint] of expected.entries()) {
    assert.ok(Math.abs(actual[index][0] - expectedPoint[0]) < 1e-9);
    assert.ok(Math.abs(actual[index][1] - expectedPoint[1]) < 1e-9);
  }
}

test("Source QAngle matrices preserve Valve pitch and roll conventions", () => {
  assertMatrixNear(sourceAngleMatrix([90, 0, 0]), [
    [0, 0, 1],
    [0, 1, 0],
    [-1, 0, 0],
  ]);
  assertMatrixNear(sourceAngleMatrix([0, 0, 90]), [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ]);
});

test("solid props are promoted only by real model PHYS bounds", async () => {
  let inspections = 0;
  const prop = entity("prop_static", "physical_prop", {
    solid: "6",
    model: "models/props/test.vmdl",
  });
  prop.angles = "0 90 0";
  prop.scales = "2 1 1";
  const duplicate = { ...prop, targetname: "physical_prop_2", properties: {
    ...prop.properties,
    targetname: "physical_prop_2",
  } };
  const tilted = { ...prop, targetname: "tilted_prop", angles: "10 0 0", properties: {
    ...prop.properties,
    targetname: "tilted_prop",
  } };

  const obstacles = await resolveMapCollisionObstacles(
    [prop, duplicate, tilted],
    "test.vpk",
    async (_vpk, model) => {
      inspections++;
      return {
        model,
        status: "physical-bounds",
        bounds: [{ min: [-10, -20, 0], max: [10, 20, 50] }],
        source: "vrf-phys",
        fromCache: false,
        detail: "one PHYS hull",
      };
    },
  );

  assert.equal(inspections, 1, "the same model is inspected once per map");
  assert.equal(obstacles[0].confidence, "physical-model-bounds");
  assert.equal(obstacles[1].confidence, "physical-model-bounds");
  assert.equal(obstacles[2].confidence, "physical-model-bounds");
  assert.equal(physicalObstacleContainsPoint(obstacles[0], [256, 512], 140), true);
  assert.equal(physicalObstacleContainsPoint(obstacles[0], [400, 512], 140), false);
});

test("pitched and rolled PHYS bounds project all eight corners conservatively", async () => {
  const pitched = entity("prop_static", "pitched_prop", {
    solid: "6",
    model: "models/props/tilted.vmdl",
  });
  pitched.origin = "0 0 0";
  pitched.angles = "90 0 0";
  const rolled = { ...pitched, targetname: "rolled_prop", angles: "0 0 90", properties: {
    ...pitched.properties,
    targetname: "rolled_prop",
  } };
  const compound = { ...pitched, targetname: "compound_prop", angles: "35 25 15", properties: {
    ...pitched.properties,
    targetname: "compound_prop",
  } };
  const malformed = { ...pitched, targetname: "malformed_prop", angles: "not angles", properties: {
    ...pitched.properties,
    targetname: "malformed_prop",
  } };
  const obstacles = await resolveMapCollisionObstacles(
    [pitched, rolled, compound, malformed],
    "test.vpk",
    async (_vpk, model) => ({
      model,
      status: "physical-bounds",
      bounds: [{ min: [-1, -2, 0], max: [1, 2, 4] }],
      source: "vrf-phys",
      fromCache: false,
      detail: "one PHYS hull",
    }),
  );

  assertPointsNear(obstacles[0].physicalFootprints![0].points, [
    [0, -2],
    [4, -2],
    [4, 2],
    [0, 2],
  ]);
  assert.ok(Math.abs(obstacles[0].physicalFootprints![0].minZ + 1) < 1e-9);
  assert.ok(Math.abs(obstacles[0].physicalFootprints![0].maxZ - 1) < 1e-9);
  assert.equal(physicalObstacleContainsPoint(obstacles[0], [2, 0], 0), true);

  assertPointsNear(obstacles[1].physicalFootprints![0].points, [
    [-1, -4],
    [1, -4],
    [1, 0],
    [-1, 0],
  ]);
  assert.ok(Math.abs(obstacles[1].physicalFootprints![0].minZ + 2) < 1e-9);
  assert.ok(Math.abs(obstacles[1].physicalFootprints![0].maxZ - 2) < 1e-9);
  assert.equal(obstacles[2].physicalFootprints?.[0].points.length, 6);
  assert.equal(obstacles[3].confidence, "unknown-model-bounds");
  assert.match(obstacles[3].reason, /malformed or degenerate transform/);
});

test("exact PHYS hull vertices replace the enclosing bounds projection", async () => {
  const prop = entity("prop_static", "exact_hull", {
    solid: "6",
    model: "models/props/exact.vmdl",
  });
  prop.origin = "0 0 0";
  const [obstacle] = await resolveMapCollisionObstacles(
    [prop],
    "test.vpk",
    async (_vpk, model) => ({
      model,
      status: "physical-bounds",
      bounds: [{
        min: [-10, -10, 0],
        max: [10, 10, 20],
        vertices: [[-10, -10, 0], [10, -10, 0], [0, 10, 0], [0, 0, 20]],
        geometry: "convex-hull",
      }],
      source: "vrf-phys",
      fromCache: false,
      detail: "exact PHYS hull",
    }),
  );

  assert.equal(obstacle.physicalFootprints?.[0].projection, "exact-hull");
  assert.deepEqual(obstacle.physicalFootprints?.[0].points, [
    [-10, -10],
    [10, -10],
    [0, 10],
  ]);
  assert.equal(physicalObstacleContainsPoint(obstacle, [0, 0], 10), true);
  assert.equal(physicalObstacleContainsPoint(obstacle, [8, 8], 10), false);
});

test("sphere and capsule PHYS primitives use tight conservative curved projections", async () => {
  const sphere = entity("prop_static", "round_sphere", {
    solid: "6",
    model: "models/props/sphere.vmdl",
  });
  sphere.origin = "0 0 0";
  sphere.scales = "2 1 1";
  const capsule = entity("prop_static", "round_capsule", {
    solid: "6",
    model: "models/props/capsule.vmdl",
  });
  capsule.origin = "100 0 0";

  const obstacles = await resolveMapCollisionObstacles(
    [sphere, capsule],
    "test.vpk",
    async (_vpk, model) => ({
      model,
      status: "physical-bounds",
      bounds: model.includes("sphere")
        ? [{
            min: [-10, -10, -10],
            max: [10, 10, 10],
            geometry: "sphere-bounds",
            primitive: {
              kind: "sphere",
              centers: [[0, 0, 0]],
              radiusVectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
            },
          }]
        : [{
            min: [-25, -5, -5],
            max: [25, 5, 5],
            geometry: "capsule-bounds",
            primitive: {
              kind: "capsule",
              centers: [[-20, 0, 0], [20, 0, 0]],
              radiusVectors: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
            },
          }],
      source: "vrf-phys",
      fromCache: false,
      detail: "decoded round primitive",
    }),
  );

  assert.equal(obstacles[0].physicalFootprints?.[0].projection, "curved-primitive");
  assert.equal(obstacles[0].physicalFootprints?.[0].points.length, 32);
  assert.equal(physicalObstacleContainsPoint(obstacles[0], [19, 0], 0), true);
  assert.equal(physicalObstacleContainsPoint(obstacles[0], [0, 9], 0), true);
  assert.equal(physicalObstacleContainsPoint(obstacles[0], [15, 8], 0), false);
  assert.ok(Math.abs(obstacles[0].physicalFootprints![0].minZ + 10) < 1e-9);
  assert.ok(Math.abs(obstacles[0].physicalFootprints![0].maxZ - 10) < 1e-9);

  assert.equal(obstacles[1].physicalFootprints?.[0].projection, "curved-primitive");
  assert.equal(physicalObstacleContainsPoint(obstacles[1], [124, 0], 0), true);
  assert.equal(physicalObstacleContainsPoint(obstacles[1], [100, 4], 0), true);
  assert.equal(physicalObstacleContainsPoint(obstacles[1], [100, 6], 0), false);
});

test("loose compiled addon models take precedence over the base VPK", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-addon-model-"));
  const compiled = join(root, "models", "props", "test.vmdl_c");
  try {
    await mkdir(dirname(compiled), { recursive: true });
    await writeFile(compiled, "fixture");
    let vpkInspections = 0;
    let fileInspections = 0;
    const obstacles = await resolveMapCollisionObstacles(
      [entity("prop_static", "addon_prop", {
        solid: "6",
        model: "models/props/test.vmdl",
      })],
      "base.vpk",
      async () => {
        vpkInspections++;
        throw new Error("base VPK should not be inspected");
      },
      {
        compiledModelRoots: [root],
        inspectCompiledModel: async (file, model) => {
          fileInspections++;
          assert.equal(file, compiled);
          return {
            model: model!,
            status: "physical-bounds",
            bounds: [{ min: [-32, -32, 0], max: [32, 32, 64] }],
            source: "vrf-phys",
            fromCache: false,
            detail: "addon PHYS hull",
          };
        },
      },
    );
    assert.equal(fileInspections, 1);
    assert.equal(vpkInspections, 0);
    assert.equal(obstacles[0].confidence, "physical-model-bounds");
    assert.match(obstacles[0].reason, /addon PHYS hull/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packed addon lookup shadows base models and falls through only when absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-addon-vpk-"));
  const addonVpk = join(root, "pak01_dir.vpk");
  const prop = entity("prop_static", "packed_prop", {
    solid: "6",
    model: "models/props/packed.vmdl",
  });
  const physical = (model: string, detail: string) => ({
    model,
    status: "physical-bounds" as const,
    bounds: [{ min: [-16, -16, 0] as [number, number, number], max: [16, 16, 64] as [number, number, number] }],
    source: "vrf-phys" as const,
    fromCache: false,
    detail,
  });
  try {
    await writeFile(addonVpk, "fixture");

    const shadowCalls: string[] = [];
    const shadowed = await resolveMapCollisionObstacles(
      [prop],
      "base.vpk",
      async (archive, model) => {
        shadowCalls.push(archive);
        return physical(model, "packed addon PHYS hull");
      },
      { compiledModelVpks: [addonVpk] },
    );
    assert.deepEqual(shadowCalls, [addonVpk]);
    assert.match(shadowed[0].reason, /packed addon/);

    const fallbackCalls: string[] = [];
    const fallback = await resolveMapCollisionObstacles(
      [prop],
      "base.vpk",
      async (archive, model) => {
        fallbackCalls.push(archive);
        if (archive === addonVpk) return {
          model,
          status: "error",
          bounds: [],
          source: "vrf-phys",
          fromCache: false,
          detail: "The model was not found in the compiled-addon VPK.",
        };
        return physical(model, "base PHYS hull");
      },
      { compiledModelVpks: [addonVpk] },
    );
    assert.deepEqual(fallbackCalls, [addonVpk, "base.vpk"]);
    assert.match(fallback[0].reason, /base PHYS/);

    const failedCalls: string[] = [];
    const failed = await resolveMapCollisionObstacles(
      [prop],
      "base.vpk",
      async (archive, model) => {
        failedCalls.push(archive);
        return {
          model,
          status: "error",
          bounds: [],
          source: "vrf-phys",
          fromCache: false,
          detail: "VRF physics inspection failed safely.",
        };
      },
      { compiledModelVpks: [addonVpk] },
    );
    assert.deepEqual(failedCalls, [addonVpk]);
    assert.equal(failed[0].confidence, "unknown-model-bounds");
    assert.match(failed[0].reason, /failed safely/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
