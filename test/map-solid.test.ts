import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExtrudedSolidMesh,
  buildMapSolidBlock,
  mapSolidFaceMaterialPlan,
  mapSolidFaceTextureScalePlan,
  mapSolidFaceTextureShiftPlan,
  mapSolidFaceTextureRotationPlan,
  mapSolidSharedTextureAxes,
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

const slopedConcaveSolid = {
  ...concaveSolid,
  targetname: "fixture_sloped_concave_wall",
  extrusion: {
    points: concaveSolid.extrusion.points,
    bottom: [-192, -64, -64, -128, -256, -256],
    top: [64, 192, 192, 128, 0, 0],
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
    () => parseManagedMapSolids([{ ...concaveSolid, faceMaterials: {} }]),
    /must override top, bottom, or both/,
  );
  assert.throws(
    () => parseManagedMapSolids([{
      ...concaveSolid,
      faceMaterials: { top: "materials/tools/toolsplayerclip.vmat" },
    }]),
    /visible world material/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureScales: {} }]),
    /must override top, bottom, sides/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureScales: { top: [0, 1] } }]),
    /must be non-zero/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureScales: { sides: [1, 4097] } }]),
    /within \+\/-4096/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureShifts: {} }]),
    /must override top, bottom, sides/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureShifts: { top: [0, 32769] } }]),
    /less than or equal to 32768/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureRotations: {} }]),
    /must override top, bottom, sides/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureRotations: { sides: -181 } }]),
    /greater than or equal to -180/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureAlignments: {} }]),
    /must set top, bottom, sides/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, faceTextureAlignments: { top: "world" } }]),
    /Invalid literal value|Invalid input/,
  );
  assert.throws(
    () => parseManagedMapSolids([{ ...concaveSolid, properties: { Solidity: 0 } }]),
    /controlled by the checked solid recipe/,
  );
  assert.throws(
    () => parseManagedMapSolids([{
      ...slopedConcaveSolid,
      extrusion: { ...slopedConcaveSolid.extrusion, top: [64, 192, 192] },
    }]),
    /one local height for every outline point/,
  );
  assert.throws(
    () => parseManagedMapSolids([{
      ...slopedConcaveSolid,
      extrusion: { ...slopedConcaveSolid.extrusion, top: [-256, 192, 192, 128, 0, 0] },
    }]),
    /above the matching bottom height/,
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

test("checked solids assign distinct top, bottom, and side materials deterministically", () => {
  const styled = {
    ...concaveSolid,
    targetname: "fixture_styled_concave_wall",
    faceMaterials: {
      top: "materials/dev/reflectivity_50.vmat",
      bottom: "materials/dev/reflectivity_20.vmat",
    },
  };
  const parsed = parseManagedMapSolids([styled])![0];
  const plan = mapSolidFaceMaterialPlan(parsed);
  assert.deepEqual(plan.materials, [
    "materials/dev/reflectivity_30.vmat",
    "materials/dev/reflectivity_50.vmat",
    "materials/dev/reflectivity_20.vmat",
  ]);
  assert.deepEqual(plan.faceMaterialIndices, [
    1, 1, 1, 1,
    2, 2, 2, 2,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  const first = reconcileMapSolids(EMPTY_MAP, [parsed]);
  assert.match(
    first.text,
    /"materials" "string_array" \[ "materials\/dev\/reflectivity_30\.vmat", "materials\/dev\/reflectivity_50\.vmat", "materials\/dev\/reflectivity_20\.vmat" \]/,
  );
  assert.deepEqual(parseMapSolids(first.text)[0]?.faceMaterials, styled.faceMaterials);
  assert.deepEqual(reconcileMapSolids(first.text, [parsed]).unchanged, [styled.targetname]);

  const changed = {
    ...parsed,
    faceMaterials: { ...parsed.faceMaterials, top: "materials/dev/reflectivity_70.vmat" },
  };
  assert.deepEqual(reconcileMapSolids(first.text, [changed]).updated, [styled.targetname]);
});

test("checked solids assign role-based texture projection settings and reconcile them", () => {
  const textured = parseManagedMapSolids([{
    ...concaveSolid,
    targetname: "fixture_scaled_concave_wall",
    faceTextureScales: {
      top: [0.25, 0.5],
      bottom: [-1, 2],
      sides: [2, 4],
    },
    faceTextureShifts: {
      top: [0, 64],
      bottom: [-128, 256],
      sides: [16, -16],
    },
    faceTextureRotations: {
      top: 45,
      bottom: -90,
      sides: 180,
    },
    faceTextureAlignments: {
      top: "shared",
      bottom: "shared",
      sides: "shared",
    },
  }])![0];
  const plan = mapSolidFaceTextureScalePlan(textured).faceTextureScales;
  assert.deepEqual(plan, [
    ...Array.from({ length: 4 }, () => [0.25, 0.5]),
    ...Array.from({ length: 4 }, () => [-1, 2]),
    ...Array.from({ length: 12 }, () => [2, 4]),
  ]);
  assert.deepEqual(mapSolidFaceTextureShiftPlan(textured).faceTextureShifts, [
    ...Array.from({ length: 4 }, () => [0, 64]),
    ...Array.from({ length: 4 }, () => [-128, 256]),
    ...Array.from({ length: 12 }, () => [16, -16]),
  ]);
  assert.deepEqual(mapSolidFaceTextureRotationPlan(textured).faceTextureRotations, [
    ...Array(4).fill(45),
    ...Array(4).fill(-90),
    ...Array(12).fill(180),
  ]);
  const aligned = mapSolidSharedTextureAxes(buildExtrudedSolidMesh(textured), textured);
  assert.equal(new Set(aligned.textureAxisU.slice(0, 4)).size, 1);
  assert.equal(new Set(aligned.textureAxisU.slice(4, 8)).size, 1);
  for (let side = 0; side < 6; side++) {
    assert.equal(aligned.textureAxisU[8 + side * 2], aligned.textureAxisU[9 + side * 2]);
    assert.equal(aligned.textureAxisV[8 + side * 2], aligned.textureAxisV[9 + side * 2]);
  }

  const first = reconcileMapSolids(EMPTY_MAP, [textured]);
  assert.deepEqual(parseMapSolids(first.text)[0]?.faceTextureScales, textured.faceTextureScales);
  assert.deepEqual(parseMapSolids(first.text)[0]?.faceTextureShifts, textured.faceTextureShifts);
  assert.deepEqual(parseMapSolids(first.text)[0]?.faceTextureRotations, textured.faceTextureRotations);
  assert.deepEqual(parseMapSolids(first.text)[0]?.faceTextureAlignments, textured.faceTextureAlignments);
  assert.deepEqual(reconcileMapSolids(first.text, [textured]).unchanged, [textured.targetname]);

  const changed = {
    ...textured,
    faceTextureScales: { ...textured.faceTextureScales, top: [0.5, 0.5] as [number, number] },
  };
  assert.deepEqual(reconcileMapSolids(first.text, [changed]).updated, [textured.targetname]);
  const shifted = {
    ...textured,
    faceTextureShifts: { ...textured.faceTextureShifts, top: [1, 64] as [number, number] },
  };
  assert.deepEqual(reconcileMapSolids(first.text, [shifted]).updated, [textured.targetname]);
  const rotated = {
    ...textured,
    faceTextureRotations: { ...textured.faceTextureRotations, top: 30 },
  };
  assert.deepEqual(reconcileMapSolids(first.text, [rotated]).updated, [textured.targetname]);
});

test("paired height rings produce a watertight sloped concave solid", () => {
  const mesh = buildExtrudedSolidMesh(slopedConcaveSolid);
  assert.equal(mesh.vertices.length, 12);
  assert.deepEqual(mesh.vertices.slice(0, 6).map((vertex) => Number(vertex.split(" ")[2])),
    slopedConcaveSolid.extrusion.top);
  assert.deepEqual(mesh.vertices.slice(6).map((vertex) => Number(vertex.split(" ")[2])),
    slopedConcaveSolid.extrusion.bottom);
  const first = reconcileMapSolids(EMPTY_MAP, [slopedConcaveSolid]);
  assert.deepEqual(parseMapSolids(first.text), [{
    targetname: slopedConcaveSolid.targetname,
    center: slopedConcaveSolid.center,
    yaw: 0,
    material: slopedConcaveSolid.material,
    footprint: slopedConcaveSolid.extrusion.points,
    sloped: {
      bottom: slopedConcaveSolid.extrusion.bottom,
      top: slopedConcaveSolid.extrusion.top,
    },
    blocking: true,
  }]);
  assert.deepEqual(reconcileMapSolids(first.text, [slopedConcaveSolid]).unchanged,
    [slopedConcaveSolid.targetname]);

  const verticallyOffset = {
    ...slopedConcaveSolid,
    targetname: "fixture_offset_concave_wall",
    extrusion: {
      points: slopedConcaveSolid.extrusion.points,
      bottom: slopedConcaveSolid.extrusion.points.map(() => -64),
      top: slopedConcaveSolid.extrusion.points.map(() => 192),
    },
  };
  const offsetText = reconcileMapSolids(EMPTY_MAP, [verticallyOffset]).text;
  assert.deepEqual(parseMapSolids(offsetText)[0]?.sloped, {
    bottom: verticallyOffset.extrusion.bottom,
    top: verticallyOffset.extrusion.top,
  });
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
