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
    managedVolumes: [
      {
        targetname: "river_no_wards",
        recipe: "noWards",
        center: [0, 0, 256],
        size: [1024, 512, 512],
      },
    ],
  });

  assert.deepEqual(specification.requiredEntities, []);
  assert.equal(specification.managedEntities?.[0].properties?.teamnumber, "2");
  assert.equal(specification.managedEntities?.[0].properties?.enabled, "true");
  assert.equal(specification.managedTerrain?.[0].op, "height");
  assert.equal(specification.managedTerrain?.[1].op, "ramp");
  assert.equal(specification.managedVolumes?.[0].recipe, "noWards");
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

test("reconcileMapSpecification applies entities, paths, and volumes idempotently", () => {
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
    managedVolumes: [
      {
        targetname: "objective_bounds",
        recipe: "heroTrigger",
        center: [0, 0, 128],
        size: [512, 512, 256],
      },
    ],
  });

  const first = reconcileMapSpecification(EMPTY_MAP, specification);
  assert.equal(first.changed, true);
  assert.deepEqual(first.entities.added, ["objective", "creep_route_1", "creep_route_2"]);
  assert.deepEqual(first.volumes.added, ["objective_bounds"]);
  assert.equal(parseMapEntities(first.text).length, 4);

  const second = reconcileMapSpecification(first.text, specification);
  assert.equal(second.changed, false);
  assert.deepEqual(second.entities.unchanged, ["objective", "creep_route_1", "creep_route_2"]);
  assert.deepEqual(second.volumes.unchanged, ["objective_bounds"]);
});

test("named regions can be reused and mirrored around a chosen tile point", () => {
  const specification = parseMapSpecification({
    regions: {
      west_platform: {
        shape: { kind: "rect", x0: 2, y0: 4, x1: 6, y1: 10 },
      },
      east_platform: {
        mirrorOf: "west_platform",
        mirrorAxis: "x",
        around: [16, 16],
      },
    },
    managedTerrain: [
      { op: "height", level: 1, shape: { kind: "region", name: "west_platform" } },
      { op: "height", level: 1, shape: { kind: "region", name: "east_platform" } },
    ],
  });

  assert.deepEqual(specification.managedTerrain, [
    { op: "height", level: 1, dome: undefined, shape: { kind: "rect", x0: 2, y0: 4, x1: 6, y1: 10 } },
    { op: "height", level: 1, dome: undefined, shape: { kind: "rect", x0: 26, y0: 4, x1: 30, y1: 10 } },
  ]);
});

test("component placements namespace and transform entities, paths, references, terrain, and volumes", () => {
  const specification = parseMapSpecification({
    regions: {
      platform: { shape: { kind: "circle", cx: 0, cy: 0, r: 3 } },
    },
    components: {
      guarded_platform: {
        managedEntities: [
          {
            targetname: "tower",
            classname: "npc_dota_tower",
            origin: "10 20 30",
            angles: "0 30 0",
            properties: { target: "@local:route_1", teamnumber: 2 },
          },
        ],
        managedPaths: [
          {
            name: "route",
            points: [[0, 0, 0], [100, 0, 0]],
          },
        ],
        managedTerrain: [
          {
            op: "height",
            level: 1,
            shape: { kind: "region", name: "platform" },
          },
          {
            op: "ramp",
            shape: { kind: "managedPath", name: "route", width: 2 },
          },
        ],
        managedVolumes: [
          {
            targetname: "bounds",
            recipe: "playerClip",
            center: [100, 200, 64],
            size: [600, 200, 256],
            yaw: 30,
            properties: { OnUser1: "@local:tower,Disable,,0,-1" },
          },
          {
            targetname: "asymmetric_bounds",
            recipe: "noWards",
            center: [0, 0, 64],
            polygon: {
              points: [[-200, -100], [200, -100], [100, 200], [-200, 100]],
              height: 256,
            },
          },
        ],
      },
    },
    placements: [
      {
        component: "guarded_platform",
        name: "west",
        worldOffset: [-1000, 0, 128],
        tileOffset: [8, 12],
      },
      {
        component: "guarded_platform",
        name: "east",
        worldOffset: [1000, 0, 128],
        tileOffset: [24, 12],
        mirrorAxis: "x",
      },
    ],
  });

  assert.deepEqual(
    specification.managedEntities?.map(({ targetname, origin, angles, properties }) => ({
      targetname,
      origin,
      angles,
      properties,
    })),
    [
      {
        targetname: "west_tower",
        origin: "-990 20 158",
        angles: "0 30 0",
        properties: { target: "west_route_1", teamnumber: "2" },
      },
      {
        targetname: "east_tower",
        origin: "990 20 158",
        angles: "0 150 0",
        properties: { target: "east_route_1", teamnumber: "2" },
      },
    ],
  );
  assert.deepEqual(specification.managedPaths?.map(({ name, points }) => ({ name, points })), [
    { name: "west_route", points: [[-1000, 0, 128], [-900, 0, 128]] },
    { name: "east_route", points: [[1000, 0, 128], [900, 0, 128]] },
  ]);
  assert.deepEqual(specification.managedTerrain, [
    { op: "height", level: 1, dome: undefined, shape: { kind: "circle", cx: 8, cy: 12, r: 3 } },
    { op: "ramp", shape: { kind: "managedPath", name: "west_route", width: 2 } },
    { op: "height", level: 1, dome: undefined, shape: { kind: "circle", cx: 24, cy: 12, r: 3 } },
    { op: "ramp", shape: { kind: "managedPath", name: "east_route", width: 2 } },
  ]);
  assert.deepEqual(specification.managedVolumes, [
    {
      targetname: "west_bounds",
      recipe: "playerClip",
      center: [-900, 200, 192],
      size: [600, 200, 256],
      yaw: 30,
      properties: { OnUser1: "west_tower,Disable,,0,-1" },
    },
    {
      targetname: "west_asymmetric_bounds",
      recipe: "noWards",
      center: [-1000, 0, 192],
      polygon: {
        points: [[-200, -100], [200, -100], [100, 200], [-200, 100]],
        height: 256,
      },
      yaw: 0,
      properties: undefined,
    },
    {
      targetname: "east_bounds",
      recipe: "playerClip",
      center: [900, 200, 192],
      size: [600, 200, 256],
      yaw: 150,
      properties: { OnUser1: "east_tower,Disable,,0,-1" },
    },
    {
      targetname: "east_asymmetric_bounds",
      recipe: "noWards",
      center: [1000, 0, 192],
      polygon: {
        points: [[-200, -100], [100, -200], [200, 100], [-200, 100]],
        height: 256,
      },
      yaw: 180,
      properties: undefined,
    },
  ]);
});

test("mirrored component volumes keep sloped corner heights paired with their footprint", () => {
  const specification = parseMapSpecification({
    components: {
      ramp_guard: {
        managedVolumes: [{
          targetname: "slope",
          recipe: "playerClip",
          center: [0, 0, 128],
          polygon: {
            points: [[-200, -100], [200, -100], [100, 200], [-200, 100]],
            bottom: [-64, 64, 32, -64],
            top: [64, 192, 160, 64],
          },
        }],
      },
    },
    placements: [{ component: "ramp_guard", name: "east", mirrorAxis: "x" }],
  });
  const polygon = specification.managedVolumes?.[0].polygon;
  assert.deepEqual(polygon, {
    points: [[-200, -100], [100, -200], [200, 100], [-200, 100]],
    bottom: [-64, 32, 64, -64],
    top: [64, 160, 192, 64],
  });
});

test("component definitions reject unsafe or unresolved reuse", () => {
  assert.throws(
    () =>
      parseMapSpecification({
        components: {
          whole_map: {
            managedTerrain: [{ op: "fill", level: 1 }],
          },
        },
      }),
    /cannot contain a fill terrain operation/,
  );
  assert.throws(
    () =>
      parseMapSpecification({
        placements: [{ component: "missing", name: "instance" }],
      }),
    /references missing component "missing"/,
  );
  assert.throws(
    () =>
      parseMapSpecification({
        regions: {
          a: { mirrorOf: "b", mirrorAxis: "x" },
          b: { mirrorOf: "a", mirrorAxis: "y" },
        },
      }),
    /mirror cycle/,
  );
});
