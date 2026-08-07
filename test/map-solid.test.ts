import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExtrudedSolidMesh,
  buildMapSolidBlock,
  parseManagedMapSolids,
  parseMapSolids,
  reconcileMapSolids,
  triangulateSimplePolygon,
} from "../src/dota/map-solid.js";
import { parseMapEntities } from "../src/dota/vmap.js";
import { buildBoxVolumeBlock } from "../src/dota/map-volume.js";

const EMPTY_MAP = `<!-- dmx encoding keyvalues2 1 format vmap 35 -->
"root" "CMapRootElement"
{
  "world" "CMapWorld"
  {
    "id" "elementid" "00000000-0000-0000-0000-000000000001"
    "nodeID" "int" "1"
    "children" "element_array" [ ]
  }
}`;

const concaveSolid = {
  targetname: "fixture_concave_wall",
  center: [0, 0, 128] as [number, number, number],
  material: "materials/dev/reflectivity_30.vmat",
  extrusion: {
    points: [
      [-384, -384], [384, -384], [384, -128],
      [-128, -128], [-128, 384], [-384, 384],
    ] as [number, number][],
    height: 256,
  },
};

test("simple concave outlines triangulate without adding vertices", () => {
  const triangles = triangulateSimplePolygon(concaveSolid.extrusion.points);
  assert.equal(triangles.length, concaveSolid.extrusion.points.length - 2);
  assert.deepEqual(
    [...new Set(triangles.flat())].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5],
  );
  const clockwise = parseManagedMapSolids([{
    ...concaveSolid,
    extrusion: { ...concaveSolid.extrusion, points: [...concaveSolid.extrusion.points].reverse() },
  }])![0];
  assert.deepEqual(clockwise.extrusion.points, concaveSolid.extrusion.points);
});

test("managed solids reject unsafe outlines, materials, and property overrides", () => {
  assert.throws(
    () => parseManagedMapSolids([{
      ...concaveSolid,
      extrusion: { points: [[-100, -100], [100, 100], [-100, 100], [100, -100]], height: 128 },
    }]),
    /self-intersect|enclose more than/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, material: "../outside.vmat" }]),
    /materials\/\.\.\.vmat asset path/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, material: "materials/tools/toolsplayerclip.vmat" }]),
    /visible world material/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, properties: { Solidity: 0 } }]),
    /controlled by the checked solid recipe/,
  );
});

test("a concave extrusion becomes a closed solid Source 2 mesh", () => {
  const mesh = buildExtrudedSolidMesh(concaveSolid);
  assert.equal(mesh.vertices.length, 12);
  assert.equal(mesh.faceEdgeIndices.length, 20);
  assert.equal(mesh.edgeVertexIndices.length, 60);
  assert.equal(new Set(mesh.edgeDataIndices).size, 30);

  const block = buildMapSolidBlock(concaveSolid, 2, 3);
  assert.match(block, /"CMapMesh"/);
  assert.match(block, /materials\/dev\/reflectivity_30\.vmat/);
  const entity = parseMapEntities(block)[0];
  assert.equal(entity.classname, "func_brush");
  assert.equal(entity.properties.Solidity, "2");
  assert.equal(entity.properties.AlwaysSolidIgnoreNav, "0");
  assert.equal(entity.targetname, concaveSolid.targetname);
});

test("managed solids reconcile idempotently and detect topology drift", () => {
  const first = reconcileMapSolids(EMPTY_MAP, [concaveSolid]);
  assert.deepEqual(first.added, [concaveSolid.targetname]);
  const inspected = parseMapSolids(first.text);
  assert.deepEqual(inspected, [{
    targetname: concaveSolid.targetname,
    center: concaveSolid.center,
    yaw: 0,
    material: concaveSolid.material,
    footprint: concaveSolid.extrusion.points,
    height: concaveSolid.extrusion.height,
    blocking: true,
  }]);

  const second = reconcileMapSolids(first.text, [concaveSolid]);
  assert.deepEqual(second.unchanged, [concaveSolid.targetname]);
  assert.equal(second.text, first.text);

  const changed = {
    ...concaveSolid,
    extrusion: {
      ...concaveSolid.extrusion,
      points: concaveSolid.extrusion.points.map(([x, y], index) =>
        index === 3 ? [x - 64, y] as [number, number] : [x, y] as [number, number]),
    },
  };
  const third = reconcileMapSolids(second.text, [changed]);
  assert.deepEqual(third.updated, [concaveSolid.targetname]);
  assert.deepEqual(reconcileMapSolids(third.text, [changed]).unchanged, [concaveSolid.targetname]);
});

test("solid inspection does not double-count tool-material gameplay volumes", () => {
  const playerClip = buildBoxVolumeBlock({
    targetname: "checked_player_clip",
    recipe: "playerClip",
    center: [0, 0, 128],
    size: [256, 256, 256],
  }, 2, 3);
  const text = EMPTY_MAP.replace(
    '"children" "element_array" [ ]',
    `"children" "element_array" [ ${playerClip} ]`,
  );
  assert.deepEqual(parseMapSolids(text), []);
});
