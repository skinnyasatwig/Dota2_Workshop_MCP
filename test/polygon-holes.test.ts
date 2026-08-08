import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionPolygonWithHoles, PolygonPoint2 } from "../src/dota/polygon-holes.js";

const outer: PolygonPoint2[] = [
  [-900, -700], [900, -700], [900, 700], [-900, 700],
];
const holes: PolygonPoint2[][] = [
  [[-700, -220], [-360, -180], [-380, 170], [-720, 140]],
  [[300, -120], [680, -210], [720, 220], [330, 180]],
];

const reverseAtAnchor = (ring: PolygonPoint2[]): PolygonPoint2[] =>
  [ring[0], ...ring.slice(1).reverse()];

test("checked multi-hole partition proves a conforming area-preserving triangle mesh", () => {
  const partition = partitionPolygonWithHoles(outer, holes);
  assert.equal(partition.triangles.length, 14);
  assert.equal(partition.points.length, 12);
  assert.equal(partition.expectedArea, 2_257_200);
  assert.equal(partition.triangleArea, partition.expectedArea);
  assert.equal(partition.relativeAreaDeviation, 0);
  assert.ok(partition.triangles.every((triangle) => new Set(triangle).size === 3));
});

test("checked multi-hole partition normalizes winding without moving the point-zero anchors", () => {
  const forward = partitionPolygonWithHoles(outer, holes);
  const reversed = partitionPolygonWithHoles(
    reverseAtAnchor(outer),
    holes.map(reverseAtAnchor),
  );
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward.rings.map((ring) => ring[0]), [outer[0], holes[0][0], holes[1][0]]);
});

test("checked multi-hole partition rejects touching, overlapping, nested, and outside holes", () => {
  assert.throws(
    () => partitionPolygonWithHoles(outer, [holes[0], holes[0]]),
    /must not touch or overlap/,
  );
  assert.throws(
    () => partitionPolygonWithHoles(outer, [holes[0], [[-600, -100], [-500, -100], [-500, 0], [-600, 0]]]),
    /independent rather than nested or overlapping/,
  );
  assert.throws(
    () => partitionPolygonWithHoles(outer, [holes[0], holes[1].map(([x, y]) => [x + 1000, y])]),
    /strictly inside the outer outline/,
  );
});

test("checked multi-hole partition fails closed on a nonconforming candidate", () => {
  assert.throws(
    () => partitionPolygonWithHoles(outer, [
      [[-700, -180], [-340, -180], [-340, 180], [-700, 180]],
      [[340, -180], [700, -180], [700, 180], [340, 180]],
    ]),
    /candidate produced .* expected/,
  );
});

test("checked multi-hole partition revalidates geometry after output rounding", () => {
  assert.throws(
    () => partitionPolygonWithHoles([
      [0, 0], [0.0000004, 0.0000004], [1000, 0], [1000, 1000], [0, 1000],
    ], [
      [[100, 100], [100, 200], [200, 200], [200, 100]],
      [[700, 700], [700, 800], [800, 800], [800, 700]],
    ]),
    /unsafe after output rounding: must not contain duplicate points/,
  );
});
