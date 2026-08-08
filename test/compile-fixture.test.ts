import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRepositoryCompileFixtureText,
  inspectRepositoryCompileFixture,
} from "../src/dota/compile-fixture.js";

const EMPTY_TEST_VMAP = `<!-- dmx encoding keyvalues2 1 format vmap 35 -->
"root" "CMapRootElement"
{
  "world" "CMapWorld"
  {
    "id" "elementid" "00000000-0000-0000-0000-000000000001"
    "nodeID" "int" "1"
    "children" "element_array" [ ]
  }
}`;

test("repository compile fixture is self-contained and structurally inspectable", () => {
  const text = buildRepositoryCompileFixtureText(EMPTY_TEST_VMAP);
  const fixture = inspectRepositoryCompileFixture(text);
  assert.match(text, /format vmap 35/);
  assert.deepEqual(
    fixture.entities.map((entity) => entity.targetname).sort(),
    [
      "fixture_arch_left_post",
      "fixture_arch_lintel",
      "fixture_arch_right_post",
      "fixture_base_blocker",
      "fixture_bridge_approach_ramp",
      "fixture_bridge_deck",
      "fixture_concave_solid",
      "fixture_dire_start",
      "fixture_dire_team_core_start",
      "fixture_dire_team_core_tower",
      "fixture_irregular_platform_segment_01_deck",
      "fixture_irregular_platform_segment_02_deck",
      "fixture_irregular_platform_segment_03_deck",
      "fixture_irregular_platform_segment_04_deck",
      "fixture_irregular_platform_segment_05_deck",
      "fixture_irregular_platform_segment_06_deck",
      "fixture_irregular_platform_segment_07_deck",
      "fixture_irregular_platform_segment_08_deck",
      "fixture_nav_obstruction",
      "fixture_polygon_no_wards",
      "fixture_profile_arch_arch_segment_01",
      "fixture_profile_arch_arch_segment_02",
      "fixture_profile_arch_arch_segment_03",
      "fixture_profile_arch_arch_segment_04",
      "fixture_profile_arch_left_post",
      "fixture_profile_arch_right_post",
      "fixture_radiant_start",
      "fixture_radiant_team_core_start",
      "fixture_radiant_team_core_tower",
      "fixture_ring_platform_segment_01_deck",
      "fixture_ring_platform_segment_02_deck",
      "fixture_ring_platform_segment_03_deck",
      "fixture_ring_platform_segment_04_deck",
      "fixture_ring_platform_segment_05_deck",
      "fixture_ring_platform_segment_06_deck",
      "fixture_ring_platform_segment_07_deck",
      "fixture_ring_platform_segment_08_deck",
      "fixture_route_1",
      "fixture_route_2",
      "fixture_sloped_concave_solid",
      "fixture_sloped_trigger",
    ],
  );
  const radiantTower = fixture.entities.find(
    (entity) => entity.targetname === "fixture_radiant_team_core_tower",
  );
  assert.equal(radiantTower?.properties.teamnumber, "2");
  assert.equal(radiantTower?.properties.MapUnitName, "npc_dota_goodguys_tower2_mid");
  assert.equal(radiantTower?.properties.model, "models/props_structures/radiant_tower002.vmdl");
  const direTower = fixture.entities.find(
    (entity) => entity.targetname === "fixture_dire_team_core_tower",
  );
  assert.equal(direTower?.properties.teamnumber, "3");
  assert.equal(direTower?.properties.direside, "1");
  assert.equal(direTower?.properties.MapUnitName, "npc_dota_badguys_tower2_mid");
  assert.equal(direTower?.properties.model, "models/props_structures/dire_tower002.vmdl");
  assert.equal(
    fixture.entities.find((entity) => entity.targetname === "fixture_radiant_team_core_start")?.classname,
    "info_player_start_goodguys",
  );
  assert.equal(
    fixture.entities.find((entity) => entity.targetname === "fixture_dire_team_core_start")?.classname,
    "info_player_start_badguys",
  );
  assert.equal(fixture.solids.length, 29);
  const concave = fixture.solids.find((solid) => solid.targetname === "fixture_concave_solid");
  assert.equal(concave?.footprint.length, 6);
  assert.equal(concave?.height, 256);
  const slopedConcave = fixture.solids.find(
    (solid) => solid.targetname === "fixture_sloped_concave_solid",
  );
  assert.deepEqual(slopedConcave?.sloped, {
    bottom: [-192, -64, -64, -128, -256, -256],
    top: [64, 192, 192, 128, 0, 0],
  });
  const lintel = fixture.solids.find((solid) => solid.targetname === "fixture_arch_lintel");
  assert.deepEqual(lintel?.center.map((value) => Number(value.toFixed(6))), [-2048, 1024, 768]);
  assert.equal(lintel?.height, 256);
  const profileSegment = fixture.solids.find(
    (solid) => solid.targetname === "fixture_profile_arch_arch_segment_01",
  );
  assert.deepEqual(profileSegment?.center, [-3360, 2048, 512]);
  assert.deepEqual(profileSegment?.sloped, {
    bottom: [0, 216, 216, 0],
    top: [384, 384, 384, 384],
  });
  const bridge = fixture.solids.find((solid) => solid.targetname === "fixture_bridge_deck");
  assert.deepEqual(bridge?.center, [-2048, -1024, 384]);
  assert.equal(bridge?.height, 64);
  assert.deepEqual(bridge?.footprint, [[-512, -192], [512, -192], [512, 192], [-512, 192]]);
  const approach = fixture.solids.find((solid) => solid.targetname === "fixture_bridge_approach_ramp");
  assert.deepEqual(approach?.center, [1536, 0, 256]);
  assert.deepEqual(approach?.sloped, {
    bottom: [-192, 64, 64, -192],
    top: [-128, 128, 128, -128],
  });
  assert.deepEqual(fixture.navSurfaces.map((surface) => surface.targetname).sort(), [
    "fixture_bridge_approach_walkable",
    "fixture_bridge_walkable",
    "fixture_irregular_platform_segment_01_walkable",
    "fixture_irregular_platform_segment_02_walkable",
    "fixture_irregular_platform_segment_03_walkable",
    "fixture_irregular_platform_segment_04_walkable",
    "fixture_irregular_platform_segment_05_walkable",
    "fixture_irregular_platform_segment_06_walkable",
    "fixture_irregular_platform_segment_07_walkable",
    "fixture_irregular_platform_segment_08_walkable",
    "fixture_ring_platform_segment_01_walkable",
    "fixture_ring_platform_segment_02_walkable",
    "fixture_ring_platform_segment_03_walkable",
    "fixture_ring_platform_segment_04_walkable",
    "fixture_ring_platform_segment_05_walkable",
    "fixture_ring_platform_segment_06_walkable",
    "fixture_ring_platform_segment_07_walkable",
    "fixture_ring_platform_segment_08_walkable",
  ]);
  const bridgeSurface = fixture.navSurfaces.find((surface) => surface.targetname === "fixture_bridge_walkable");
  assert.deepEqual(bridgeSurface?.center, [-2048, -1024, 384]);
  assert.equal(bridgeSurface?.height, 64);
  const ringSegments = fixture.solids.filter((solid) =>
    solid.targetname.startsWith("fixture_ring_platform_segment_"));
  assert.equal(ringSegments.length, 8);
  assert.ok(ringSegments.every((solid) => solid.footprint.length === 4 && solid.height === 64));
  const irregularSegments = fixture.solids.filter((solid) =>
    solid.targetname.startsWith("fixture_irregular_platform_segment_"));
  assert.equal(irregularSegments.length, 8);
  assert.ok(irregularSegments.every((solid) => solid.footprint.length === 4 && solid.height === 64));
  assert.equal(fixture.solids.filter((solid) =>
    solid.targetname.startsWith("fixture_profile_arch_arch_segment_")).length, 4);
  assert.equal(fixture.volumes.length, 2);
  const round = fixture.volumes.find((volume) => volume.targetname === "fixture_polygon_no_wards");
  assert.equal(round?.footprint.length, 12);
  assert.equal(round?.recipe, "noWards");
  const sloped = fixture.volumes.find((volume) => volume.targetname === "fixture_sloped_trigger");
  assert.equal(sloped?.recipe, "trigger");
  assert.deepEqual(sloped?.sloped, {
    bottom: [-128, -128, 0, 0],
    top: [128, 128, 256, 256],
  });
});
