import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBoxVolumeBlock,
  MAP_VOLUME_RECIPES,
  parseMapBoxVolumes,
  parseManagedMapVolumes,
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
  const parsed = parseMapBoxVolumes(generated.text);
  assert.deepEqual(parsed, [{
    targetname: blocker.targetname,
    classname: "func_brush",
    recipe: "playerClip",
    center: blocker.center,
    size: blocker.size,
    yaw: 30,
    material: "materials/tools/toolsplayerclip.vmat",
    blocking: true,
  }]);
});
