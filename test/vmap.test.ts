import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEntityBlock,
  parseMapEntities,
  patchMapEntities,
  rewriteWaypointPath,
} from "../src/dota/vmap.js";

test("parseMapEntities extracts class, targetname, target and origin", () => {
  const text =
    `"root" "CMapRootElement"\n{\n` +
    buildEntityBlock(
      {
        classname: "path_corner",
        origin: "100 200 128",
        properties: {
          targetname: "path_radiant_north_1",
          target: "path_radiant_north_2",
        },
      },
      42,
    ) +
    `}\n`;
  const entities = parseMapEntities(text);
  assert.equal(entities.length, 1);
  assert.deepEqual(
    {
      classname: entities[0].classname,
      origin: entities[0].origin,
      nodeId: entities[0].nodeId,
      targetname: entities[0].targetname,
      target: entities[0].target,
    },
    {
      classname: "path_corner",
      origin: "100 200 128",
      nodeId: 42,
      targetname: "path_radiant_north_1",
      target: "path_radiant_north_2",
    },
  );
});

test("parseMapEntities handles braces inside string properties", () => {
  const text = buildEntityBlock(
    {
      classname: "logic_script",
      properties: {
        targetname: "script_runner",
        code: "function(){ return { ok = true }; }",
      },
    },
    7,
  );
  const entities = parseMapEntities(text);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].properties.code, "function(){ return { ok = true }; }");
});

test("patchMapEntities updates class, targetname, transforms, and properties", () => {
  const text = buildEntityBlock(
    {
      classname: "info_target",
      origin: "100 200 128",
      properties: { targetname: "radiant_t1_marker", comment: "placeholder" },
    },
    8,
  );
  const result = patchMapEntities(text, [
    {
      targetname: "radiant_t1_marker",
      classname: "npc_dota_tower",
      newTargetname: "radiant_t1",
      origin: "128 256 128",
      properties: { teamnumber: 2 },
      removeProperties: ["comment"],
    },
  ]);
  assert.deepEqual(result.unmatched, []);
  const entity = parseMapEntities(result.text)[0];
  assert.equal(entity.classname, "npc_dota_tower");
  assert.equal(entity.targetname, "radiant_t1");
  assert.equal(entity.origin, "128 256 128");
  assert.equal(entity.properties.teamnumber, "2");
  assert.equal(entity.properties.comment, undefined);
});

test("rewriteWaypointPath converts and renames a complete ordered chain", () => {
  const text = [0, 1, 2]
    .map((index) =>
      buildEntityBlock(
        {
          classname: "path_track",
          properties: {
            targetname: `radiant_north_route_0${index}`,
            target: index < 2 ? `radiant_north_route_0${index + 1}` : "",
            speed: 325,
          },
        },
        index + 1,
      ),
    )
    .join("\n");
  const result = rewriteWaypointPath(text, "radiant_north_route_", "path_radiant_north_", "path_corner", 1);
  const entities = parseMapEntities(result.text);
  assert.deepEqual(
    entities.map((entity) => ({
      classname: entity.classname,
      targetname: entity.targetname,
      target: entity.target,
      speed: entity.properties.speed,
    })),
    [
      { classname: "path_corner", targetname: "path_radiant_north_1", target: "path_radiant_north_2", speed: undefined },
      { classname: "path_corner", targetname: "path_radiant_north_2", target: "path_radiant_north_3", speed: undefined },
      { classname: "path_corner", targetname: "path_radiant_north_3", target: undefined, speed: undefined },
    ],
  );
});
