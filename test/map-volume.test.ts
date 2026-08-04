import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBoxVolumeBlock,
  buildPolygonVolumeBlock,
  MAP_VOLUME_RECIPES,
  parseMapVolumes,
  parseManagedMapVolumes,
  regularPolygonFootprint,
  reconcileMapVolumes,
} from "../src/dota/map-volume.js";
import { parseMapEntities } from "../src/dota/vmap.js";

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

const camp = {
  targetname: "north_small_camp_bounds",
  recipe: "camp" as const,
  center: [1024, 2048, 192] as [number, number, number],
  size: [768, 640, 384] as [number, number, number],
};

test("checked volume recipes reject unsafe geometry and reserved overrides", () => {
  assert.throws(
    () => parseManagedMapVolumes([{ ...camp, size: [0, 640, 384] }]),
    /greater than 0/,
  );
  assert.throws(
    () => parseManagedMapVolumes([{ ...camp, properties: { classname: "logic_script" } }]),
    /controlled by the checked volume recipe/,
  );
  assert.throws(
    () => parseManagedMapVolumes([{
      targetname: "concave_bounds",
      recipe: "noWards",
      center: [0, 0, 128],
      polygon: { points: [[-256, -256], [256, -256], [0, 0], [256, 256], [-256, 256]], height: 256 },
    }]),
    /must be convex/,
  );
  assert.throws(
    () => parseManagedMapVolumes([{
      targetname: "crossed_bounds",
      recipe: "noWards",
      center: [0, 0, 128],
      polygon: { points: [[-256, -256], [256, 256], [-256, 256], [256, -256]], height: 256 },
    }]),
    /self-intersect|non-zero area/,
  );
  assert.equal(MAP_VOLUME_RECIPES.noWards.classname, "trigger_no_wards");
  assert.equal(MAP_VOLUME_RECIPES.playerClip.properties.Solidity, "2");
});

test("a Valve-topology box volume carries its checked entity and material", () => {
  const block = buildBoxVolumeBlock(camp, 2, 3);
  assert.match(block, /"CMapMesh"/);
  assert.match(block, /"CDmePolygonMesh"/);
  assert.match(block, /materials\/tools\/toolstrigger\.vmat/);
  assert.match(block, /"classname" "string" "trigger_multiple"/);
  assert.match(block, /"position:0"/);
  assert.doesNotMatch(block, /source1_brushmodel_index/);
  const [entity] = parseMapEntities(block);
  assert.equal(entity.targetname, camp.targetname);
  assert.equal(entity.classname, "trigger_multiple");
});

test("a convex polygon becomes a closed Valve-topology prism", () => {
  const polygon = {
    targetname: "dragon_no_wards",
    recipe: "noWards" as const,
    center: [0, 2048, 384] as [number, number, number],
    polygon: {
      points: [
        [-256, -128], [0, -256], [256, -128], [320, 128],
        [128, 320], [-128, 320], [-320, 128],
      ] as [number, number][],
      height: 512,
    },
  };
  const block = buildPolygonVolumeBlock(polygon, 2, 3);
  const parsed = parseMapVolumes(EMPTY_MAP.replace("\"children\" \"element_array\" [ ]", `\"children\" \"element_array\" [ ${block} ]`));
  assert.equal(parsed[0]?.targetname, polygon.targetname);
  assert.equal(parsed[0]?.footprint.length, 7);
  assert.deepEqual(parsed[0]?.size, [640, 576, 512]);
  assert.match(block, /"vertexData"[\s\S]*?"size" "int" "14"/);
  assert.match(block, /"faceVertexData"[\s\S]*?"size" "int" "42"/);
  assert.match(block, /"faceData"[\s\S]*?"size" "int" "9"/);
});

test("circumscribed regular footprints preserve the requested minimum radius", () => {
  const points = regularPolygonFootprint(875, 32, true);
  const vertexRadius = Math.hypot(points[0][0], points[0][1]);
  assert.ok(Math.abs(vertexRadius * Math.cos(Math.PI / points.length) - 875) < 1e-6);
  assert.ok(vertexRadius / 875 < 1.005);
});

test("managed box volumes reconcile idempotently and update geometry", () => {
  const first = reconcileMapVolumes(EMPTY_MAP, [camp]);
  assert.deepEqual(first.added, [camp.targetname]);
  assert.equal(first.updated.length, 0);

  const second = reconcileMapVolumes(first.text, [camp]);
  assert.deepEqual(second.unchanged, [camp.targetname]);
  assert.equal(second.text, first.text);

  const wider = { ...camp, size: [1024, 640, 384] as [number, number, number] };
  const third = reconcileMapVolumes(second.text, [wider]);
  assert.deepEqual(third.updated, [camp.targetname]);
  const fourth = reconcileMapVolumes(third.text, [wider]);
  assert.deepEqual(fourth.unchanged, [camp.targetname]);
  assert.equal(fourth.text, third.text);
});

test("generated player blockers can be inspected from VMAP text", () => {
  const blocker = {
    targetname: "radiant_base_wall",
    recipe: "playerClip" as const,
    center: [640, 384, 256] as [number, number, number],
    size: [768, 128, 512] as [number, number, number],
    yaw: 30,
  };
  const generated = reconcileMapVolumes(EMPTY_MAP, [blocker]);
  const parsed = parseMapVolumes(generated.text);
  assert.deepEqual(parsed, [{
    targetname: blocker.targetname,
    classname: "func_brush",
    recipe: "playerClip",
    center: blocker.center,
    size: blocker.size,
    footprint: [[-384, -64], [384, -64], [384, 64], [-384, 64]],
    yaw: 30,
    material: "materials/tools/toolsplayerclip.vmat",
    blocking: true,
  }]);
});

test("managed polygon volumes reconcile idempotently and detect same-bounds shape drift", () => {
  const diamond = {
    targetname: "roshan_no_wards",
    recipe: "noWards" as const,
    center: [0, -2048, 256] as [number, number, number],
    polygon: {
      points: [[0, -512], [512, 0], [0, 512], [-512, 0]] as [number, number][],
      height: 512,
    },
  };
  const first = reconcileMapVolumes(EMPTY_MAP, [diamond]);
  const second = reconcileMapVolumes(first.text, [diamond]);
  assert.deepEqual(second.unchanged, [diamond.targetname]);
  assert.equal(second.text, first.text);

  const clipped = {
    ...diamond,
    polygon: {
      ...diamond.polygon,
      points: [[0, -512], [512, 0], [128, 512], [-512, 0]] as [number, number][],
    },
  };
  const third = reconcileMapVolumes(second.text, [clipped]);
  assert.deepEqual(third.updated, [diamond.targetname]);
  assert.deepEqual(reconcileMapVolumes(third.text, [clipped]).unchanged, [diamond.targetname]);
});
