import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectMapCollisionObstacles,
  distanceToSegment2d,
  DOTA_OBSTRUCTION_BROAD_PHASE_RADIUS,
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
