import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClosedHalfEdgeMesh } from "../src/dota/map-mesh.js";

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

