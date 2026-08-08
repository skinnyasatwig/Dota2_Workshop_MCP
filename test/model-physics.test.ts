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
    { min: [-10.5, -20, 0], max: [10.5, 20, 48], geometry: "bounds" },
    { min: [50, 60, -4], max: [70, 80, 12], geometry: "bounds" },
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
    geometry: "convex-hull",
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
  const translated = parseVrfPhysicsBounds(block(
    vertices,
    "1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30",
  ))[0];
  assert.deepEqual(translated.min, [9, 19, 30]);
  assert.deepEqual(translated.max, [11, 21, 32]);
  assert.deepEqual(translated.vertices?.[0], [9, 19, 30]);
});

test("bind poses carry mesh, sphere, and capsule PHYS shapes into model space", () => {
  const meshVertices: [number, number, number][] = [
    [-1, -1, 0],
    [1, -1, 0],
    [0, 1, 0],
    [0, 0, 2],
  ];
  const text = `
    --- Data for block "PHYS" ---
    {
      m_bindPose = [ [
        1, 0, 0, 10,
        0, 1, 0, 20,
        0, 0, 1, 30,
      ] ]
      m_parts = [ {
        m_rnShape = {
          m_spheres = [ { m_Sphere = {
            m_vCenter = [ 2, 0, 0 ]
            m_flRadius = 1
          } } ]
          m_capsules = [ { m_Capsule = {
            m_vCenter = [ [ -2, 0, 0 ], [ -2, 0, 4 ] ]
            m_flRadius = 0.5
          } } ]
          m_hulls = [ { m_Hull = {
            m_Bounds = {
              m_vMinBounds = [ -2, -2, -2 ]
              m_vMaxBounds = [ 0, 0, 0 ]
            }
            m_Vertices = [
              [ -2, -2, -2 ],
              [ 0, -2, -2 ],
              [ -2, 0, -2 ],
              [ -2, -2, 0 ],
            ]
          } } ]
          m_meshes = [ { m_Mesh = {
            m_vMin = [ -1, -1, 0 ]
            m_vMax = [ 1, 1, 2 ]
            m_Vertices = #[ ${float3Blob(meshVertices)} ]
          } } ]
        }
      } ]
    }
  `;
  const shapes = parseVrfPhysicsBounds(text);
  assert.deepEqual(shapes.map(({ min, max, geometry }) => ({ min, max, geometry })), [
    { min: [8, 18, 28], max: [10, 20, 30], geometry: "convex-hull" },
    { min: [9, 19, 30], max: [11, 21, 32], geometry: "mesh-vertex-hull" },
    { min: [11, 19, 29], max: [13, 21, 31], geometry: "sphere-bounds" },
    { min: [7.5, 19.5, 29.5], max: [8.5, 20.5, 34.5], geometry: "capsule-bounds" },
  ]);
  assert.deepEqual(shapes[0].vertices?.[0], [8, 18, 28]);
  assert.deepEqual(shapes[1].vertices?.[0], [9, 19, 30]);
  assert.deepEqual(shapes[2].primitive, {
    kind: "sphere",
    centers: [[12, 20, 30]],
    radiusVectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  });
  assert.deepEqual(shapes[3].primitive, {
    kind: "capsule",
    centers: [[8, 20, 30], [8, 20, 34]],
    radiusVectors: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]],
  });
});

test("round PHYS primitives retain non-uniform bind-pose radius vectors", () => {
  const shapes = parseVrfPhysicsBounds(`
    --- Data for block "PHYS" ---
    {
      m_bindPose = [ [
        2, 0, 0, 10,
        0, 3, 0, 20,
        0, 0, 4, 30,
      ] ]
      m_parts = [ { m_rnShape = {
        m_spheres = [ { m_Sphere = {
          m_vCenter = [ 1, 2, 3 ]
          m_flRadius = 2
        } } ]
      } } ]
    }
  `);
  assert.deepEqual(shapes, [{
    min: [8, 20, 34],
    max: [16, 32, 50],
    geometry: "sphere-bounds",
    primitive: {
      kind: "sphere",
      centers: [[12, 26, 42]],
      radiusVectors: [[4, 0, 0], [0, 6, 0], [0, 0, 8]],
    },
  }]);
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
  assert.ok(first.bounds.some((bounds) => bounds.geometry === "convex-hull"));
  assert.equal(second.status, "physical-bounds");
  assert.equal(second.fromCache, true);
});

test("VRF retains curved primitives from a known base-game model", {
  skip: !process.env.DOTA2_TEST_VPK,
}, async () => {
  const inspection = await inspectVpkModelPhysics(
    process.env.DOTA2_TEST_VPK!,
    "models/heroes/juggernaut/juggernaut.vmdl",
  );
  assert.equal(inspection.status, "physical-bounds");
  const capsules = inspection.bounds.filter((bounds) => bounds.primitive?.kind === "capsule");
  assert.ok(capsules.length >= 1);
  assert.ok(capsules.every((bounds) => bounds.primitive?.centers.length === 2));
  assert.ok(capsules.every((bounds) => bounds.primitive?.radiusVectors.length === 3));
});
