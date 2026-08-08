import earcut, { deviation } from "earcut";
import {
  pointOnSegment,
  segmentsTouchOrIntersect,
  signedPolygonArea,
  simplePolygonError,
} from "./map-solid.js";

export type PolygonPoint2 = [number, number];

export interface CheckedPolygonHolePartition {
  /** Normalized outer ring followed by normalized hole rings. */
  rings: PolygonPoint2[][];
  /** Flattened ring vertices referenced by triangles. */
  points: PolygonPoint2[];
  /** Counter-clockwise, conforming triangles that exactly partition the usable area. */
  triangles: [number, number, number][];
  expectedArea: number;
  triangleArea: number;
  relativeAreaDeviation: number;
}

const EPSILON = 1e-8;

function cross(a: PolygonPoint2, b: PolygonPoint2, c: PolygonPoint2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function samePoint(a: PolygonPoint2, b: PolygonPoint2): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

function normalizedNumber(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}

function orientedRing(points: readonly PolygonPoint2[], counterClockwise: boolean): PolygonPoint2[] {
  const copied = points.map(([x, y]) => [normalizedNumber(x), normalizedNumber(y)] as PolygonPoint2);
  const wrongDirection = (signedPolygonArea(copied) > 0) !== counterClockwise;
  return wrongDirection ? [copied[0], ...copied.slice(1).reverse()] : copied;
}

function pointStrictlyInsidePolygon(point: PolygonPoint2, polygon: readonly PolygonPoint2[]): boolean {
  if (polygon.some((start, index) => pointOnSegment(point, start, polygon[(index + 1) % polygon.length]))) {
    return false;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    if (
      (y > point[1]) !== (previousY > point[1]) &&
      point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x
    ) inside = !inside;
  }
  return inside;
}

function pointInsideOrOnPolygon(point: PolygonPoint2, polygon: readonly PolygonPoint2[]): boolean {
  return polygon.some((start, index) => pointOnSegment(point, start, polygon[(index + 1) % polygon.length])) ||
    pointStrictlyInsidePolygon(point, polygon);
}

function properSegmentsCross(
  a: PolygonPoint2,
  b: PolygonPoint2,
  c: PolygonPoint2,
  d: PolygonPoint2,
): boolean {
  return cross(a, b, c) * cross(a, b, d) < -EPSILON &&
    cross(c, d, a) * cross(c, d, b) < -EPSILON;
}

function pointStrictlyInsideTriangle(
  point: PolygonPoint2,
  a: PolygonPoint2,
  b: PolygonPoint2,
  c: PolygonPoint2,
): boolean {
  return cross(a, b, point) > EPSILON &&
    cross(b, c, point) > EPSILON &&
    cross(c, a, point) > EPSILON;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function directedEdgeKey(a: number, b: number): string {
  return `${a}:${b}`;
}

function validateRingRelationships(outer: PolygonPoint2[], holes: PolygonPoint2[][]): void {
  for (const [holeIndex, hole] of holes.entries()) {
    for (const [pointIndex, point] of hole.entries()) {
      if (!pointStrictlyInsidePolygon(point, outer)) {
        throw new Error(`holes.${holeIndex}.${pointIndex} must stay strictly inside the outer outline`);
      }
    }
    for (let outerEdge = 0; outerEdge < outer.length; outerEdge++) {
      for (let holeEdge = 0; holeEdge < hole.length; holeEdge++) {
        if (segmentsTouchOrIntersect(
          outer[outerEdge], outer[(outerEdge + 1) % outer.length],
          hole[holeEdge], hole[(holeEdge + 1) % hole.length],
        )) throw new Error(`holes.${holeIndex} must not touch or cross the outer outline`);
      }
    }
  }

  for (let first = 0; first < holes.length; first++) {
    for (let second = first + 1; second < holes.length; second++) {
      for (let firstEdge = 0; firstEdge < holes[first].length; firstEdge++) {
        for (let secondEdge = 0; secondEdge < holes[second].length; secondEdge++) {
          if (segmentsTouchOrIntersect(
            holes[first][firstEdge], holes[first][(firstEdge + 1) % holes[first].length],
            holes[second][secondEdge], holes[second][(secondEdge + 1) % holes[second].length],
          )) throw new Error(`holes.${first} and holes.${second} must not touch or overlap`);
        }
      }
      if (
        pointStrictlyInsidePolygon(holes[first][0], holes[second]) ||
        pointStrictlyInsidePolygon(holes[second][0], holes[first])
      ) throw new Error(`holes.${first} and holes.${second} must be independent rather than nested or overlapping`);
    }
  }
}

function validateTriangleOverlap(
  points: readonly PolygonPoint2[],
  triangles: readonly [number, number, number][],
): void {
  for (let first = 0; first < triangles.length; first++) {
    const firstTriangle = triangles[first];
    for (let second = first + 1; second < triangles.length; second++) {
      const secondTriangle = triangles[second];
      for (let firstEdge = 0; firstEdge < 3; firstEdge++) {
        const aIndex = firstTriangle[firstEdge];
        const bIndex = firstTriangle[(firstEdge + 1) % 3];
        for (let secondEdge = 0; secondEdge < 3; secondEdge++) {
          const cIndex = secondTriangle[secondEdge];
          const dIndex = secondTriangle[(secondEdge + 1) % 3];
          if (edgeKey(aIndex, bIndex) === edgeKey(cIndex, dIndex)) continue;
          if (properSegmentsCross(points[aIndex], points[bIndex], points[cIndex], points[dIndex])) {
            throw new Error(`candidate triangles ${first} and ${second} cross`);
          }
        }
      }
      for (const vertex of firstTriangle) {
        if (secondTriangle.includes(vertex)) continue;
        if (pointStrictlyInsideTriangle(
          points[vertex],
          points[secondTriangle[0]], points[secondTriangle[1]], points[secondTriangle[2]],
        )) throw new Error(`candidate triangle ${first} overlaps triangle ${second}`);
      }
      for (const vertex of secondTriangle) {
        if (firstTriangle.includes(vertex)) continue;
        if (pointStrictlyInsideTriangle(
          points[vertex],
          points[firstTriangle[0]], points[firstTriangle[1]], points[firstTriangle[2]],
        )) throw new Error(`candidate triangle ${second} overlaps triangle ${first}`);
      }
    }
  }
}

/**
 * Generate and then independently prove a conforming partition of one outline with independent holes.
 * Earcut proposes triangles; boundary, manifold, area, overlap, T-junction, and connectivity checks decide acceptance.
 */
export function partitionPolygonWithHoles(
  outerInput: readonly PolygonPoint2[],
  holesInput: readonly (readonly PolygonPoint2[])[],
): CheckedPolygonHolePartition {
  if (!holesInput.length) throw new Error("at least one hole is required");
  if (outerInput.length + holesInput.reduce((count, hole) => count + hole.length, 0) > 128) {
    throw new Error("outer and hole outlines may contain at most 128 points in total");
  }
  const outerError = simplePolygonError(outerInput);
  if (outerError) throw new Error(`outer outline ${outerError}`);
  for (const [index, hole] of holesInput.entries()) {
    const holeError = simplePolygonError(hole);
    if (holeError) throw new Error(`holes.${index} outline ${holeError}`);
  }

  const outer = orientedRing(outerInput, true);
  const holes = holesInput.map((hole) => orientedRing(hole, false));
  const roundedOuterError = simplePolygonError(outer);
  if (roundedOuterError) throw new Error(`outer outline becomes unsafe after output rounding: ${roundedOuterError}`);
  for (const [index, hole] of holes.entries()) {
    const roundedHoleError = simplePolygonError(hole);
    if (roundedHoleError) {
      throw new Error(`holes.${index} outline becomes unsafe after output rounding: ${roundedHoleError}`);
    }
  }
  validateRingRelationships(outer, holes);
  const rings = [outer, ...holes];
  const points = rings.flat();
  const flat = points.flatMap(([x, y]) => [x, y]);
  const holeIndices: number[] = [];
  let cursor = outer.length;
  for (const hole of holes) {
    holeIndices.push(cursor);
    cursor += hole.length;
  }
  const candidate = earcut(flat, holeIndices, 2);
  const expectedTriangleCount = points.length + 2 * holes.length - 2;
  if (candidate.length !== expectedTriangleCount * 3) {
    throw new Error(`candidate produced ${candidate.length / 3} triangles; expected ${expectedTriangleCount}`);
  }

  const triangles: [number, number, number][] = [];
  let triangleArea = 0;
  for (let index = 0; index < candidate.length; index += 3) {
    const raw = candidate.slice(index, index + 3);
    if (raw.some((vertex) => !Number.isInteger(vertex) || vertex < 0 || vertex >= points.length)) {
      throw new Error(`candidate triangle ${index / 3} contains an invalid vertex index`);
    }
    if (new Set(raw).size !== 3) throw new Error(`candidate triangle ${index / 3} repeats a vertex`);
    let triangle = raw as [number, number, number];
    let area = signedPolygonArea(triangle.map((vertex) => points[vertex]));
    if (area < 0) {
      triangle = [triangle[0], triangle[2], triangle[1]];
      area = -area;
    }
    if (area <= 1) throw new Error(`candidate triangle ${index / 3} is too small or degenerate`);
    const centroid: PolygonPoint2 = [
      (points[triangle[0]][0] + points[triangle[1]][0] + points[triangle[2]][0]) / 3,
      (points[triangle[0]][1] + points[triangle[1]][1] + points[triangle[2]][1]) / 3,
    ];
    if (
      !pointStrictlyInsidePolygon(centroid, outer) ||
      holes.some((hole) => pointInsideOrOnPolygon(centroid, hole))
    ) throw new Error(`candidate triangle ${index / 3} leaves the usable platform area`);
    triangles.push(triangle);
    triangleArea += area;
  }

  const boundaryEdges = new Map<string, string>();
  let ringOffset = 0;
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index++) {
      const from = ringOffset + index;
      const to = ringOffset + (index + 1) % ring.length;
      const key = edgeKey(from, to);
      if (boundaryEdges.has(key)) throw new Error("declared boundaries repeat an edge");
      boundaryEdges.set(key, directedEdgeKey(from, to));
    }
    ringOffset += ring.length;
  }

  const edgeOwners = new Map<string, { triangle: number; from: number; to: number }[]>();
  for (const [triangleIndex, triangle] of triangles.entries()) {
    for (let edge = 0; edge < 3; edge++) {
      const from = triangle[edge];
      const to = triangle[(edge + 1) % 3];
      const key = edgeKey(from, to);
      const owners = edgeOwners.get(key) ?? [];
      owners.push({ triangle: triangleIndex, from, to });
      edgeOwners.set(key, owners);
    }
  }
  for (const [key, owners] of edgeOwners) {
    const boundaryDirection = boundaryEdges.get(key);
    if (boundaryDirection !== undefined) {
      if (owners.length !== 1 || directedEdgeKey(owners[0].from, owners[0].to) !== boundaryDirection) {
        throw new Error(`candidate does not preserve directed boundary edge ${key}`);
      }
    } else if (
      owners.length !== 2 || owners[0].from !== owners[1].to || owners[0].to !== owners[1].from
    ) throw new Error(`candidate internal edge ${key} is not a two-sided manifold seam`);
  }
  for (const key of boundaryEdges.keys()) {
    if (!edgeOwners.has(key)) throw new Error(`candidate omits declared boundary edge ${key}`);
  }

  for (const [key, owners] of edgeOwners) {
    const [a, b] = [owners[0].from, owners[0].to];
    for (let vertex = 0; vertex < points.length; vertex++) {
      if (vertex === a || vertex === b) continue;
      if (pointOnSegment(points[vertex], points[a], points[b])) {
        throw new Error(`candidate edge ${key} contains a T-junction at vertex ${vertex}`);
      }
    }
  }
  validateTriangleOverlap(points, triangles);

  const adjacency = triangles.map(() => new Set<number>());
  for (const [key, owners] of edgeOwners) {
    if (boundaryEdges.has(key) || owners.length !== 2) continue;
    adjacency[owners[0].triangle].add(owners[1].triangle);
    adjacency[owners[1].triangle].add(owners[0].triangle);
  }
  const visited = new Set<number>();
  const queue = triangles.length ? [0] : [];
  while (queue.length) {
    const triangle = queue.shift()!;
    if (visited.has(triangle)) continue;
    visited.add(triangle);
    queue.push(...adjacency[triangle]);
  }
  if (visited.size !== triangles.length) throw new Error("candidate triangle partition is disconnected");

  const expectedArea = Math.abs(signedPolygonArea(outer)) -
    holes.reduce((area, hole) => area + Math.abs(signedPolygonArea(hole)), 0);
  const areaTolerance = Math.max(1e-5, expectedArea * 1e-8);
  if (expectedArea <= 1 || Math.abs(triangleArea - expectedArea) > areaTolerance) {
    throw new Error("candidate triangles do not exactly cover the usable platform area");
  }
  const relativeAreaDeviation = deviation(flat, holeIndices, 2, candidate);
  if (!Number.isFinite(relativeAreaDeviation) || relativeAreaDeviation > 1e-8) {
    throw new Error("candidate triangulation has unacceptable relative area deviation");
  }

  return { rings, points, triangles, expectedArea, triangleArea, relativeAreaDeviation };
}
