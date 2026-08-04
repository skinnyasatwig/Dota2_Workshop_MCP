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
