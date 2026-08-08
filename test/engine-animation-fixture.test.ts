import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINE_ANIMATION_CLIENT_TARGET,
  ENGINE_ANIMATION_FOCUS_TARGET,
  ENGINE_ANIMATION_FRAME_SETTINGS,
  ENGINE_ANIMATION_MODEL,
  ENGINE_ANIMATION_SEQUENCE,
  ENGINE_ANIMATION_SERVER_TARGET,
  buildEngineAnimationFixtureText,
  inspectEngineAnimationFixture,
} from "../src/dota/engine-animation-fixture.js";

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

test("animation fixture keeps one exact client target and one server cycle probe", () => {
  const inspection = inspectEngineAnimationFixture(buildEngineAnimationFixtureText(EMPTY_TEST_VMAP));
  assert.equal(inspection.passed, true, inspection.issues.join("\n"));
  assert.equal(inspection.client?.targetname, ENGINE_ANIMATION_CLIENT_TARGET);
  assert.equal(inspection.client?.properties.model, ENGINE_ANIMATION_MODEL);
  assert.equal(inspection.client?.properties.StartingAnim, ENGINE_ANIMATION_SEQUENCE);
  assert.equal(inspection.client?.properties.AnimateOnServer, "0");
  assert.equal(inspection.client?.properties.CreateNavObstacle, "0");
  assert.equal(inspection.client?.scales, "2 2 2");
  assert.equal(inspection.client?.origin, "0 350 142");
  assert.equal(inspection.client?.angles, "0 90 0");
  assert.equal(inspection.server?.targetname, ENGINE_ANIMATION_SERVER_TARGET);
  assert.equal(inspection.server?.properties.AnimateOnServer, "1");
  assert.equal(inspection.focus?.targetname, ENGINE_ANIMATION_FOCUS_TARGET);
  assert.equal(inspection.focus?.classname, "info_target");
  assert.equal(inspection.focus?.origin, "0 350 0");
  assert.deepEqual(ENGINE_ANIMATION_FRAME_SETTINGS, {
    distance: 1600,
    yaw: 90,
    pitch: 60,
    heightOffset: 530,
    hideHero: true,
  });
});

test("animation fixture inspection fails closed on changed runtime properties", () => {
  const text = buildEngineAnimationFixtureText(EMPTY_TEST_VMAP)
    .replace('"AnimateOnServer" "string" "0"', '"AnimateOnServer" "string" "1"');
  const inspection = inspectEngineAnimationFixture(text);
  assert.equal(inspection.passed, false);
  assert.match(inspection.issues.join("\n"), /AnimateOnServer/);
});
