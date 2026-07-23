import { test } from "node:test";
import assert from "node:assert/strict";
import { expandWaypointPath } from "../src/tools/mapgen.tools.js";

test("expandWaypointPath can emit Dota creep path_corner chains starting at one", () => {
  const entities = expandWaypointPath({
    name: "path_radiant_north",
    classname: "path_corner",
    startIndex: 1,
    points: [
      [-6000, -2000, 128],
      [-5000, -1000, 128],
      [0, 0, 128],
    ],
  });

  assert.deepEqual(
    entities.map((entity) => ({
      classname: entity.classname,
      targetname: entity.properties.targetname,
      target: entity.properties.target,
    })),
    [
      { classname: "path_corner", targetname: "path_radiant_north_1", target: "path_radiant_north_2" },
      { classname: "path_corner", targetname: "path_radiant_north_2", target: "path_radiant_north_3" },
      { classname: "path_corner", targetname: "path_radiant_north_3", target: undefined },
    ],
  );
});

test("expandWaypointPath preserves path_track defaults and supports loops", () => {
  const entities = expandWaypointPath({
    name: "patrol",
    loop: true,
    speed: 250,
    points: [
      [0, 0, 0],
      [100, 0, 0],
    ],
  });
  assert.equal(entities[0].classname, "path_track");
  assert.equal(entities[0].properties.targetname, "patrol_0");
  assert.equal(entities[1].properties.target, "patrol_0");
  assert.equal(entities[1].properties.speed, "250");
});
