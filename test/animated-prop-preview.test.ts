import { test } from "node:test";
import assert from "node:assert/strict";
import {
  animatedPropPreviewPlan,
  auditAnimatedPropPreview,
} from "../src/dota/animated-prop-preview.js";

test("animated prop preview plans exact loops from one visual-only recipe", () => {
  const plan = animatedPropPreviewPlan("radiant-team-banner");
  assert.equal(plan.model, "models/props_teams/banner_radiant.vmdl");
  assert.equal(plan.compiledPath, "models/props_teams/banner_radiant.vmdl_c");
  assert.equal(plan.collision, "none");
  assert.equal(plan.createNavObstacle, false);
  assert.deepEqual(plan.items, [
    { sequence: "banner_radiant_idle", label: "Idle", looping: true },
    { sequence: "banner_radiant_idle2", label: "Alternate idle", looping: true },
  ]);
});

test("animated prop preview refuses missing or stale model metadata", () => {
  const plan = animatedPropPreviewPlan("dire-team-banner");
  const current = auditAnimatedPropPreview(plan, new Map([
    [plan.compiledPath, { crc: plan.expectedCrc }],
  ]));
  assert.deepEqual(current, {
    current: true,
    installed: true,
    expectedCrc: plan.expectedCrc,
    installedCrc: plan.expectedCrc,
  });
  const stale = auditAnimatedPropPreview(plan, new Map([
    [plan.compiledPath, { crc: 123 }],
  ]));
  assert.equal(stale.current, false);
  assert.equal(stale.installed, true);
  assert.equal(stale.installedCrc, 123);
  assert.equal(auditAnimatedPropPreview(plan, new Map()).installed, false);
});
