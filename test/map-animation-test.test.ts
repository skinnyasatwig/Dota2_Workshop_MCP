import assert from "node:assert/strict";
import test from "node:test";
import { inspectMapAnimationTarget } from "../src/dota/map-animation-test.js";
import { reconcileMapEntities } from "../src/dota/vmap.js";

const EMPTY = `<!-- dmx encoding keyvalues2 1 format vmap 35 -->
"root" "CMapRootElement"
{
  "world" "CMapWorld"
  {
    "id" "elementid" "00000000-0000-0000-0000-000000000001"
    "nodeID" "int" "1"
    "children" "element_array" [ ]
  }
}`;

function fixture(overrides: Record<string, string> = {}): string {
  return reconcileMapEntities(EMPTY, [{
    targetname: "banner",
    classname: "prop_dynamic",
    origin: "1 2 3",
    properties: {
      model: "models/props_teams/banner_dire.vmdl",
      StartingAnim: "banner_dire_idle",
      IdleAnim: "banner_dire_idle",
      solid: "0",
      CreateNavObstacle: "0",
      use_animgraph: "0",
      AnimateOnServer: "0",
      ...overrides,
    },
  }]).text;
}

test("map animation target preflight derives one exact safe runtime expectation", () => {
  const result = inspectMapAnimationTarget(fixture(), "banner");
  assert.equal(result.passed, true, result.issues.join("\n"));
  assert.equal(result.model, "models/props_teams/banner_dire.vmdl");
  assert.equal(result.sequence, "banner_dire_idle");
  assert.equal(result.animateOnServer, false);
  assert.equal(result.clientSafe, true);
});

test("map animation target preflight rejects missing, ambiguous, or drifting playback", () => {
  assert.match(inspectMapAnimationTarget(fixture(), "missing").issues[0], /not found/);
  const duplicated = reconcileMapEntities(fixture(), [{
    targetname: "banner_2",
    classname: "prop_dynamic",
    origin: "4 5 6",
    properties: { model: "models/props_teams/banner_dire.vmdl" },
  }], { addMissingNamed: true }).text.replaceAll("banner_2", "banner");
  assert.match(inspectMapAnimationTarget(duplicated, "banner").issues[0], /ambiguous \(2 entities\)/);
  assert.match(inspectMapAnimationTarget(fixture(), "../banner").issues[0], /may contain only/);
  assert.match(
    inspectMapAnimationTarget(fixture({ IdleAnim: "banner_dire_idle2" }), "banner").issues.join(" "),
    /ambiguous/,
  );
  assert.match(
    inspectMapAnimationTarget(fixture({ solid: "6" }), "banner").issues.join(" "),
    /not explicitly non-solid/,
  );
});
