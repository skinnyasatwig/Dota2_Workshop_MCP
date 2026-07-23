import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntityBlock, parseMapEntities } from "../src/dota/vmap.js";

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
