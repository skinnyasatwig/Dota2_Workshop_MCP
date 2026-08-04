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
      "fixture_dire_start",
      "fixture_polygon_no_wards",
      "fixture_radiant_start",
      "fixture_route_1",
      "fixture_route_2",
    ],
  );
  assert.equal(fixture.volumes.length, 1);
  assert.equal(fixture.volumes[0].footprint.length, 12);
  assert.equal(fixture.volumes[0].recipe, "noWards");
});
