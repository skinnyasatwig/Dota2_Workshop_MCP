import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCompiledModelPath,
  parseVrfPhysicsBounds,
  inspectVpkModelPhysics,
} from "../src/dota/model-physics.js";

function float3Blob(vertices: readonly [number, number, number][]): string {
  const bytes = Buffer.alloc(vertices.length * 12);
  vertices.forEach((vertex, index) => {
    bytes.writeFloatLE(vertex[0], index * 12);
    bytes.writeFloatLE(vertex[1], index * 12 + 4);
    bytes.writeFloatLE(vertex[2], index * 12 + 8);
  });
  return bytes.toString("hex").match(/.{2}/g)!.join(" ");
}

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

test("VRF parser recovers validated exact convex-hull vertices", () => {
  const vertices: [number, number, number][] = [
    [-10, -20, 0],
    [10, -20, 0],
    [0, 20, 0],
    [0, 0, 48],
  ];
  const text = `
    --- Data for block "PHYS" ---
    {
      m_bindPose = [ ]
      m_hulls = [ {
        m_Hull = {
          m_Bounds = {
            m_vMinBounds = [ -10, -20, 0 ]
            m_vMaxBounds = [ 10, 20, 48 ]
          }
          m_Vertices = #[ ${float3Blob(vertices)} ]
        }
      } ]
    }
  `;
  assert.deepEqual(parseVrfPhysicsBounds(text), [{
    min: [-10, -20, 0],
    max: [10, 20, 48],
    vertices,
  }]);
});

test("new vertex-position blobs take precedence and unsafe local vertices stay bounds-only", () => {
  const vertices: [number, number, number][] = [
    [-1, -1, 0],
    [1, -1, 0],
    [0, 1, 0],
    [0, 0, 2],
  ];
  const block = (positions: readonly [number, number, number][], bindPose = "") => `
    --- Data for block "PHYS" ---
    {
      m_bindPose = [ ${bindPose} ]
      m_Hull = {
        m_Bounds = {
          m_vMinBounds = [ -1, -1, 0 ]
          m_vMaxBounds = [ 1, 1, 2 ]
        }
        m_Vertices = #[ 00 01 02 03 ]
        m_VertexPositions = #[ ${float3Blob(positions)} ]
      }
    }
  `;

  assert.deepEqual(parseVrfPhysicsBounds(block(vertices))[0].vertices, vertices);
  const outside = vertices.map((vertex) => [...vertex] as [number, number, number]);
  outside[0][0] = -100;
  assert.equal(parseVrfPhysicsBounds(block(outside))[0].vertices, undefined);
  assert.equal(parseVrfPhysicsBounds(block(vertices, "1, 0, 0"))[0].vertices, undefined);
});

test("compiled model paths are normalized without accepting arbitrary resources", () => {
  assert.equal(
    normalizeCompiledModelPath("models\\props_gameplay\\cap_point001.vmdl"),
    "models/props_gameplay/cap_point001.vmdl_c",
  );
  assert.equal(normalizeCompiledModelPath("models/x.vmdl_c"), "models/x.vmdl_c");
  assert.equal(normalizeCompiledModelPath("materials/x.vmat"), undefined);
  assert.equal(normalizeCompiledModelPath("models/../escape.vmdl"), undefined);
  assert.equal(normalizeCompiledModelPath("models/C:/escape.vmdl"), undefined);
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
  assert.ok(first.bounds.some((bounds) => bounds.vertices?.length));
  assert.equal(second.status, "physical-bounds");
  assert.equal(second.fromCache, true);
});
