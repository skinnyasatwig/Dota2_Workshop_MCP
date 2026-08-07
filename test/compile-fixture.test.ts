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
      "fixture_base_blocker",
      "fixture_concave_solid",
      "fixture_dire_start",
      "fixture_nav_obstruction",
      "fixture_polygon_no_wards",
      "fixture_radiant_start",
      "fixture_route_1",
      "fixture_route_2",
      "fixture_sloped_trigger",
    ],
  );
  assert.equal(fixture.solids.length, 1);
  assert.equal(fixture.solids[0]?.targetname, "fixture_concave_solid");
  assert.equal(fixture.solids[0]?.footprint.length, 6);
  assert.equal(fixture.solids[0]?.height, 256);
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
