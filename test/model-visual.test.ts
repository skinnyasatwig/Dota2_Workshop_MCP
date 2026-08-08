import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVrfRenderBounds } from "../src/dota/model-visual.js";

test("VRF render parser unions MDAT scene-object bounds but ignores hitboxes", () => {
  const output = `
--- Data for block "MDAT" ---
{
  m_sceneObjects =
  [
    { m_vMinBounds = [ -10, -20, 2 ] m_vMaxBounds = [ 30, 40, 50 ] },
    { m_vMinBounds = [ 50, -5, -3 ] m_vMaxBounds = [ 70, 12, 9 ] },
  ]
  m_constraints = [ ]
  m_hitboxsets = [ { m_vMinBounds = [ -999, -999, -999 ] m_vMaxBounds = [ 999, 999, 999 ] } ]
}
--- Data for block "DATA" ---
{ m_vMinBounds = [ -500, -500, -500 ] m_vMaxBounds = [ 500, 500, 500 ] }
`;
  assert.deepEqual(parseVrfRenderBounds(output), {
    min: [-10, -20, -3],
    max: [70, 40, 50],
  });
});

test("VRF render parser fails closed without valid scene-object bounds", () => {
  assert.equal(parseVrfRenderBounds("render bounds only"), undefined);
  assert.equal(parseVrfRenderBounds(`
--- Data for block "MDAT" ---
{ m_sceneObjects = [ { m_vMinBounds = [ 2, 2, 2 ] m_vMaxBounds = [ 1, 1, 1 ] } ] m_constraints = [ ] }
`), undefined);
});
