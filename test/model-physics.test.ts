import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCompiledModelPath,
  parseVrfPhysicsBounds,
  inspectVpkModelPhysics,
} from "../src/dota/model-physics.js";

test("VRF parser accepts only bounds inside the PHYS data block", () => {
  const text = `
    m_vMinBounds = [ -999, -999, -999 ]
    m_vMaxBounds = [ 999, 999, 999 ]
    --- Data for block "PHYS" ---
    {
      m_hulls = [
        { m_Bounds = {
          m_vMinBounds = [ -10.5, -20, 0 ]
          m_vMaxBounds = [ 10.5, 20, 48 ]
        } }
        { m_Bounds = {
          m_vMinBounds = [ 50, 60, -4 ]
          m_vMaxBounds = [ 70, 80, 12 ]
        } }
      ]
    }
  `;
  assert.deepEqual(parseVrfPhysicsBounds(text), [
    { min: [-10.5, -20, 0], max: [10.5, 20, 48] },
    { min: [50, 60, -4], max: [70, 80, 12] },
  ]);
  assert.deepEqual(parseVrfPhysicsBounds("render bounds only"), []);
});

test("compiled model paths are normalized without accepting arbitrary resources", () => {
  assert.equal(
    normalizeCompiledModelPath("models\\props_gameplay\\cap_point001.vmdl"),
    "models/props_gameplay/cap_point001.vmdl_c",
  );
  assert.equal(normalizeCompiledModelPath("models/x.vmdl_c"), "models/x.vmdl_c");
  assert.equal(normalizeCompiledModelPath("materials/x.vmat"), undefined);
});

test("VRF recovers and caches a known base-game model PHYS hull", {
  skip: !process.env.DOTA2_TEST_VPK,
}, async () => {
  const vpk = process.env.DOTA2_TEST_VPK!;
  const first = await inspectVpkModelPhysics(
    vpk,
    "models/props_gameplay/cap_point001.vmdl",
  );
  const second = await inspectVpkModelPhysics(
    vpk,
    "models/props_gameplay/cap_point001.vmdl",
  );
  assert.equal(first.status, "physical-bounds");
  assert.ok(first.bounds.length >= 1);
  assert.equal(second.status, "physical-bounds");
  assert.equal(second.fromCache, true);
});
