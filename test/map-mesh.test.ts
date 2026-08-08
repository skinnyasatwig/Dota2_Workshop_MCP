import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClosedHalfEdgeMesh, buildMapMeshNode } from "../src/dota/map-mesh.js";

const tetrahedronVertices = [
  [1, 1, 1],
  [-1, -1, 1],
  [-1, 1, -1],
  [1, -1, -1],
] as [number, number, number][];

test("closed half-edge meshes pair every outward-wound edge", () => {
  const mesh = buildClosedHalfEdgeMesh(tetrahedronVertices, [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ]);
  assert.equal(mesh.vertices.length, 4);
  assert.equal(mesh.faceEdgeIndices.length, 4);
  assert.equal(mesh.edgeVertexIndices.length, 12);
  assert.equal(new Set(mesh.edgeDataIndices).size, 6);
  mesh.edgeOppositeIndices.forEach((opposite, edge) => {
    assert.equal(mesh.edgeOppositeIndices[opposite], edge);
  });
});

test("closed half-edge meshes reject open and same-direction topology", () => {
  assert.throws(
    () => buildClosedHalfEdgeMesh(tetrahedronVertices, [[0, 2, 1]]),
    /open or non-manifold/,
  );
  assert.throws(
    () => buildClosedHalfEdgeMesh(tetrahedronVertices, [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 3, 2],
    ]),
    /not used in opposite directions|directed edge/,
  );
});

test("mesh serialization requires checked texture projection settings per face", () => {
  const mesh = buildClosedHalfEdgeMesh(tetrahedronVertices, [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ]);
  const block = buildMapMeshNode(mesh, {
    nodeId: 2,
    origin: [0, 0, 0],
    material: "materials/dev/reflectivity_30.vmat",
    faceTextureScales: [[0.25, 0.5], [1, 1], [-1, 2], [4, 4]],
    faceTextureShifts: [[0, 64], [-128, 256], [16, -16], [32, 32]],
    faceTextureRotations: [0, 45, -90, 180],
  });
  assert.match(block, /"0\.25 0\.5"/);
  assert.match(block, /"-1 2"/);
  assert.match(block, /"[^\"]+ 0"/);
  assert.match(block, /"[^\"]+ 64"/);
  assert.throws(
    () => buildMapMeshNode(mesh, {
      nodeId: 2,
      origin: [0, 0, 0],
      material: "materials/dev/reflectivity_30.vmat",
      faceTextureScales: [[1, 1]],
    }),
    /one finite, non-zero U\/V pair/,
  );
  assert.throws(
    () => buildMapMeshNode(mesh, {
      nodeId: 2,
      origin: [0, 0, 0],
      material: "materials/dev/reflectivity_30.vmat",
      faceTextureShifts: [[0, 0]],
    }),
    /one finite U\/V pair/,
  );
  assert.throws(
    () => buildMapMeshNode(mesh, {
      nodeId: 2,
      origin: [0, 0, 0],
      material: "materials/dev/reflectivity_30.vmat",
      faceTextureRotations: [181, 0, 0, 0],
    }),
    /from -180 through 180/,
  );
});
