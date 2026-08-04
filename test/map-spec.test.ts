import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseMapSpecification,
  reconcileMapSpecification,
} from "../src/dota/map-spec.js";
import { parseMapEntities } from "../src/dota/vmap.js";

const EMPTY_MAP = `<!-- dmx encoding keyvalues2 1 format vmap 35 -->
"world" "CMapWorld"
{
	"id" "elementid" "00000000-0000-0000-0000-000000000001"
	"children" "element_array" [ ]
}
`;

test("the documented map specification example stays valid", async () => {
  const path = new URL("../examples/map-specification.json", import.meta.url);
  const specification = parseMapSpecification(
    JSON.parse(await readFile(path, "utf8")),
    path.pathname,
  );

  assert.equal(specification.map, "example_arena");
  assert.equal(specification.managedPaths?.length, 2);
  assert.equal(specification.managedTerrain?.length, 3);
});

test("parseMapSpecification exposes the contract terrain and path vocabulary", () => {
  const specification = parseMapSpecification({
    map: "test_map",
    managedEntities: [
      {
        targetname: "radiant_fort",
        classname: "npc_dota_fort",
        origin: "-1024 0 128",
        properties: { teamnumber: 2, enabled: true },
      },
    ],
    managedPaths: [
      {
        name: "north_route",
        points: [[-512, 256, 128], [512, 256, 128]],
      },
      {
        name: "south_route",
        mirrorOf: "north_route",
        mirrorAxis: "y",
        points: [[-512, -256, 128], [512, -256, 128]],
      },
    ],
    managedTerrain: [
      {
        op: "height",
        level: 1,
        shape: { kind: "polygon", points: [[4, 4], [12, 4], [8, 12]] },
      },
      {
        op: "ramp",
        shape: { kind: "managedPath", name: "north_route", width: 2 },
      },
    ],
  });

  assert.deepEqual(specification.requiredEntities, []);
  assert.equal(specification.managedEntities?.[0].properties?.teamnumber, "2");
  assert.equal(specification.managedEntities?.[0].properties?.enabled, "true");
  assert.equal(specification.managedTerrain?.[0].op, "height");
  assert.equal(specification.managedTerrain?.[1].op, "ramp");
});

test("parseMapSpecification rejects unresolved managedPath terrain", () => {
  assert.throws(
    () =>
      parseMapSpecification({
        managedTerrain: [
          {
            op: "tileset",
            tileset: 1,
            shape: { kind: "managedPath", name: "missing", width: 2 },
          },
        ],
      }),
    /references missing managedPath "missing"/,
  );
});

test("reconcileMapSpecification applies entities and paths idempotently", () => {
  const specification = parseMapSpecification({
    managedEntities: [
      {
        targetname: "objective",
        classname: "info_target",
        origin: "0 0 128",
      },
    ],
    managedPaths: [
      {
        name: "creep_route",
        points: [[-256, 0, 128], [256, 0, 128]],
      },
    ],
  });

  const first = reconcileMapSpecification(EMPTY_MAP, specification);
  assert.equal(first.changed, true);
  assert.deepEqual(first.entities.added, ["objective", "creep_route_1", "creep_route_2"]);
  assert.equal(parseMapEntities(first.text).length, 3);

  const second = reconcileMapSpecification(first.text, specification);
  assert.equal(second.changed, false);
  assert.deepEqual(second.entities.unchanged, ["objective", "creep_route_1", "creep_route_2"]);
});
