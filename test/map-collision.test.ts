import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectMapCollisionObstacles,
  distanceToSegment2d,
  DOTA_OBSTRUCTION_BROAD_PHASE_RADIUS,
  physicalObstacleContainsPoint,
  resolveMapCollisionObstacles,
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
  assert.equal(obstacles[2].confidence, "unknown-model-bounds");
  assert.equal(physicalObstacleContainsPoint(obstacles[0], [256, 512], 140), true);
  assert.equal(physicalObstacleContainsPoint(obstacles[0], [400, 512], 140), false);
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
