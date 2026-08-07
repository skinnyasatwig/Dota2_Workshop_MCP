import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildClosedHalfEdgeMesh,
  buildMapMeshNode,
  MapMeshData,
  MeshPoint3,
  numberText,
  vectorText,
} from "./map-mesh.js";
import { entityBlockRanges, insertEntity, maxNodeId, parseMapEntities } from "./vmap.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const point2 = z.tuple([z.number().finite(), z.number().finite()]);
const point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const safeName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/);
const material = z.string()
  .regex(/^materials\/[A-Za-z0-9_./-]+\.vmat$/i, "must be a materials/...vmat asset path")
  .refine((value) => !value.split("/").includes(".."), "must not contain parent-directory segments")
  .refine((value) => !value.toLowerCase().startsWith("materials/tools/"),
    "must be a visible world material; use managedVolumes for tools materials");

function signedPolygonArea(points: readonly [number, number][]): number {
  return points.reduce((area, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length];
    return area + x * nextY - nextX * y;
  }, 0) / 2;
}

function cross2(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-8;
}

function pointOnSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): boolean {
  return Math.abs(cross2(start, end, point)) <= 1e-8 &&
    point[0] >= Math.min(start[0], end[0]) - 1e-8 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-8 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-8 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-8;
}

function segmentsTouchOrIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const abC = cross2(a, b, c);
  const abD = cross2(a, b, d);
  const cdA = cross2(c, d, a);
  const cdB = cross2(c, d, b);
  if (abC * abD < -1e-8 && cdA * cdB < -1e-8) return true;
  return (Math.abs(abC) <= 1e-8 && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) <= 1e-8 && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) <= 1e-8 && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) <= 1e-8 && pointOnSegment(b, c, d));
}

function simplePolygonError(points: readonly [number, number][]): string | undefined {
  if (points.length < 3) return "must contain at least three points";
  if (points.some(([x, y]) => Math.abs(x) > 16384 || Math.abs(y) > 16384)) {
    return "coordinates must stay within +/-16384 local world units";
  }
  for (let first = 0; first < points.length; first++) {
    for (let second = first + 1; second < points.length; second++) {
      if (close(points[first][0], points[second][0]) && close(points[first][1], points[second][1])) {
        return "must not contain duplicate points";
      }
    }
  }
  if (Math.abs(signedPolygonArea(points)) <= 1) return "must enclose more than one square world unit";
  for (let index = 0; index < points.length; index++) {
    if (Math.abs(cross2(
      points[(index + points.length - 1) % points.length],
      points[index],
      points[(index + 1) % points.length],
    )) <= 1e-8) return "must not contain collinear adjacent edges";
  }
  for (let first = 0; first < points.length; first++) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second++) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsTouchOrIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return "must not self-intersect or touch a non-adjacent edge";
      }
    }
  }
  return undefined;
}

export const managedMapSolidInputSchema = z.object({
  targetname: safeName,
  center: point3,
  yaw: z.number().finite().optional(),
  material,
  extrusion: z.object({
    points: z.array(point2).min(3).max(128),
    height: z.number().finite().positive().max(32768),
  }).strict(),
  properties: z.record(scalar).optional(),
}).strict().superRefine((solid, context) => {
  const polygonError = simplePolygonError(solid.extrusion.points);
  if (polygonError) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["extrusion", "points"],
      message: polygonError,
    });
  }
  for (const reserved of [
    "classname", "targetname", "origin", "angles", "source1_brushmodel_index",
    "StartDisabled", "spawnflags", "Solidity", "solidbsp", "AlwaysSolidIgnoreNav",
  ]) {
    if (solid.properties?.[reserved] !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["properties", reserved],
        message: "is controlled by the checked solid recipe",
      });
    }
  }
});

export interface ManagedMapSolid {
  targetname: string;
  center: [number, number, number];
  yaw?: number;
  material: string;
  extrusion: { points: [number, number][]; height: number };
  properties?: Record<string, string>;
}

export function parseManagedMapSolids(
  value: unknown,
  field = "managedSolids",
  path = "inline map specification",
): ManagedMapSolid[] | undefined {
  if (value === undefined) return undefined;
  const result = z.array(managedMapSolidInputSchema).safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${field}${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`)
      .join("; ");
    throw new Error(`${details}: ${path}`);
  }
  return result.data.map((solid) => {
    const points = solid.extrusion.points.map(([x, y]) => [x, y] as [number, number]);
    if (signedPolygonArea(points) < 0) points.reverse();
    return {
      ...solid,
      center: [...solid.center],
      extrusion: { points, height: solid.extrusion.height },
      properties: solid.properties
        ? Object.fromEntries(Object.entries(solid.properties).map(([key, value]) => [key, String(value)]))
        : undefined,
    };
  });
}

function pointInTriangle(
  point: [number, number],
  a: [number, number],
  b: [number, number],
  c: [number, number],
): boolean {
  const ab = cross2(a, b, point);
  const bc = cross2(b, c, point);
  const ca = cross2(c, a, point);
  return ab >= -1e-8 && bc >= -1e-8 && ca >= -1e-8;
}

/** Deterministic ear clipping for a validated counter-clockwise simple polygon. */
export function triangulateSimplePolygon(points: readonly [number, number][]): [number, number, number][] {
  const polygonError = simplePolygonError(points);
  if (polygonError) throw new Error(`Cannot triangulate polygon: ${polygonError}.`);
  const normalized = signedPolygonArea(points) < 0 ? [...points].reverse() : [...points];
  const originalIndices = signedPolygonArea(points) < 0
    ? points.map((_point, index) => points.length - index - 1)
    : points.map((_point, index) => index);
  const remaining = normalized.map((_point, index) => index);
  const triangles: [number, number, number][] = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let position = 0; position < remaining.length; position++) {
      const previous = remaining[(position + remaining.length - 1) % remaining.length];
      const current = remaining[position];
      const next = remaining[(position + 1) % remaining.length];
      if (cross2(normalized[previous], normalized[current], normalized[next]) <= 1e-8) continue;
      const contains = remaining.some((candidate) =>
        candidate !== previous && candidate !== current && candidate !== next &&
        pointInTriangle(
          normalized[candidate], normalized[previous], normalized[current], normalized[next],
        ));
      if (contains) continue;
      triangles.push([
        originalIndices[previous], originalIndices[current], originalIndices[next],
      ]);
      remaining.splice(position, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error("Cannot triangulate polygon safely.");
  }
  triangles.push(remaining.map((index) => originalIndices[index]) as [number, number, number]);
  return triangles;
}

export function buildExtrudedSolidMesh(solid: ManagedMapSolid): MapMeshData {
  const parsed = parseManagedMapSolids([solid])![0];
  const { points, height } = parsed.extrusion;
  const top = height / 2;
  const bottom = -height / 2;
  const count = points.length;
  const vertices: MeshPoint3[] = [
    ...points.map(([x, y]) => [x, y, top] as MeshPoint3),
    ...points.map(([x, y]) => [x, y, bottom] as MeshPoint3),
  ];
  const topFaces = triangulateSimplePolygon(points);
  const bottomFaces = topFaces.map(([a, b, c]) => [count + a, count + c, count + b]);
  const sideFaces: [number, number, number][] = [];
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    sideFaces.push(
      [next, index, count + index],
      [next, count + index, count + next],
    );
  }
  return buildClosedHalfEdgeMesh(vertices, [...topFaces, ...bottomFaces, ...sideFaces]);
}

function escaped(value: string | number): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const SOLID_PROPERTIES: Readonly<Record<string, string>> = {
  StartDisabled: "0",
  spawnflags: "2",
  Solidity: "2",
  solidbsp: "0",
  AlwaysSolidIgnoreNav: "0",
};

export function buildMapSolidBlock(
  solid: ManagedMapSolid,
  entityNodeId: number,
  meshNodeId = entityNodeId + 1,
): string {
  const parsed = parseManagedMapSolids([solid])![0];
  const mesh = buildExtrudedSolidMesh(parsed);
  const origin = vectorText(parsed.center);
  const yaw = numberText(((parsed.yaw ?? 0) % 360 + 360) % 360);
  const propertyLines = Object.entries({
    ...SOLID_PROPERTIES,
    ...(parsed.properties ?? {}),
    targetname: parsed.targetname,
  }).map(([key, value]) => `\t\t"${escaped(key)}" "string" "${escaped(value)}"`).join("\n");
  const meshNode = buildMapMeshNode(mesh, {
    nodeId: meshNodeId,
    origin: parsed.center,
    yaw: parsed.yaw,
    material: parsed.material,
  }).split("\n").map((line) => `\t\t${line}`).join("\n");
  return `"CMapEntity"
{
\t"id" "elementid" "${randomUUID()}"
\t"origin" "vector3" "${origin}"
\t"angles" "qangle" "0 ${yaw} 0"
\t"scales" "vector3" "1 1 1"
\t"nodeID" "int" "${entityNodeId}"
\t"children" "element_array"
\t[
${meshNode}
\t]
\t"editorOnly" "bool" "0"
\t"force_hidden" "bool" "0"
\t"variableTargetKeys" "string_array" [ ]
\t"variableNames" "string_array" [ ]
\t"relayPlugData" "DmePlugList"
\t{
\t\t"id" "elementid" "${randomUUID()}"
\t\t"names" "string_array" [ ]
\t\t"dataTypes" "int_array" [ ]
\t\t"plugTypes" "int_array" [ ]
\t\t"descriptions" "string_array" [ ]
\t}
\t"connectionsData" "element_array" [ ]
\t"entity_properties" "EditGameClassProps"
\t{
\t\t"id" "elementid" "${randomUUID()}"
\t\t"classname" "string" "func_brush"
${propertyLines}
\t}
\t"hitNormal" "vector3" "0 0 1"
\t"isProceduralEntity" "bool" "0"
}`;
}

function parseVector(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const values = value.trim().split(/\s+/).map(Number);
  return values.length === 3 && values.every(Number.isFinite)
    ? values as [number, number, number]
    : undefined;
}

function positionVertices(block: string): [number, number, number][] | undefined {
  const match = /"name"\s+"string"\s+"position:0"[\s\S]*?"data"\s+"vector3_array"\s*\[([\s\S]*?)\]/.exec(block);
  if (!match) return undefined;
  const vertices = [...match[1].matchAll(/"([^"]+)"/g)]
    .map((entry) => parseVector(entry[1]))
    .filter((entry): entry is [number, number, number] => !!entry);
  return vertices.length >= 6 && vertices.length % 2 === 0 ? vertices : undefined;
}

function integerArray(block: string, name: string): number[] | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`"${escapedName}"\\s+"int_array"\\s*\\[([\\s\\S]*?)\\]`).exec(block);
  if (!match) return undefined;
  return [...match[1].matchAll(/"(-?\d+)"/g)].map((entry) => Number(entry[1]));
}

function blockMaterial(block: string): string | undefined {
  return /"materials"\s+"string_array"\s*\[\s*"([^"]+)"/.exec(block)?.[1];
}

function sameNumbers(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameVertices(
  actual: readonly [number, number, number][] | undefined,
  expected: readonly string[],
): boolean {
  if (!actual || actual.length !== expected.length) return false;
  return actual.every((vertex, index) => {
    const expectedVertex = parseVector(expected[index]);
    return !!expectedVertex && vertex.every((value, axis) => Math.abs(value - expectedVertex[axis]) <= 1e-4);
  });
}

function solidBlockMatches(block: string, desired: ManagedMapSolid): boolean {
  const entity = parseMapEntities(block)[0];
  const center = parseVector(entity?.origin);
  const angles = parseVector(entity?.angles);
  if (!entity || entity.classname !== "func_brush" || entity.targetname !== desired.targetname) return false;
  if (!center || !center.every((value, axis) => Math.abs(value - desired.center[axis]) <= 1e-4)) return false;
  const yaw = ((desired.yaw ?? 0) % 360 + 360) % 360;
  if (!angles || Math.abs(angles[0]) > 1e-4 || Math.abs(angles[1] - yaw) > 1e-4 || Math.abs(angles[2]) > 1e-4) {
    return false;
  }
  if (blockMaterial(block) !== desired.material) return false;
  const mesh = buildExtrudedSolidMesh(desired);
  if (!sameVertices(positionVertices(block), mesh.vertices)) return false;
  for (const [name, expected] of Object.entries({
    vertexEdgeIndices: mesh.vertexEdgeIndices,
    vertexDataIndices: mesh.vertexDataIndices,
    edgeVertexIndices: mesh.edgeVertexIndices,
    edgeOppositeIndices: mesh.edgeOppositeIndices,
    edgeNextIndices: mesh.edgeNextIndices,
    edgeFaceIndices: mesh.edgeFaceIndices,
    edgeDataIndices: mesh.edgeDataIndices,
    edgeVertexDataIndices: mesh.edgeVertexDataIndices,
    faceEdgeIndices: mesh.faceEdgeIndices,
    faceDataIndices: mesh.faceDataIndices,
  })) {
    if (!sameNumbers(integerArray(block, name), expected)) return false;
  }
  const expectedProperties = { ...SOLID_PROPERTIES, ...(desired.properties ?? {}) };
  return Object.entries(expectedProperties).every(([key, value]) => entity.properties[key] === value);
}

export interface ParsedMapSolid {
  targetname: string;
  center: [number, number, number];
  yaw: number;
  material: string;
  footprint: [number, number][];
  height: number;
  blocking: true;
}

/** Read flat generated-style solid extrusions from VMAP text for inspection and preview. */
export function parseMapSolids(text: string): ParsedMapSolid[] {
  const parsed: ParsedMapSolid[] = [];
  for (const range of entityBlockRanges(text)) {
    const entity = range.entity;
    const vertices = positionVertices(range.block);
    const center = parseVector(entity.origin);
    const angles = parseVector(entity.angles) ?? [0, 0, 0];
    const materialPath = blockMaterial(range.block);
    if (
      entity.classname !== "func_brush" || !entity.targetname || entity.properties.Solidity !== "2" ||
      !vertices || !center || !materialPath || materialPath.toLowerCase().startsWith("materials/tools/")
    ) continue;
    const count = vertices.length / 2;
    const top = vertices.slice(0, count);
    const bottom = vertices.slice(count);
    if (!top.every((vertex, index) =>
      Math.abs(vertex[0] - bottom[index][0]) <= 1e-4 &&
      Math.abs(vertex[1] - bottom[index][1]) <= 1e-4)) continue;
    const topZ = top[0][2];
    const bottomZ = bottom[0][2];
    if (!top.every((vertex) => Math.abs(vertex[2] - topZ) <= 1e-4) ||
        !bottom.every((vertex) => Math.abs(vertex[2] - bottomZ) <= 1e-4) || topZ <= bottomZ) continue;
    parsed.push({
      targetname: entity.targetname,
      center,
      yaw: angles[1],
      material: materialPath,
      footprint: top.map(([x, y]) => [x, y]),
      height: topZ - bottomZ,
      blocking: true,
    });
  }
  return parsed;
}

export interface MapSolidReconcileResult {
  text: string;
  added: string[];
  updated: string[];
  unchanged: string[];
}

export function reconcileMapSolids(
  text: string,
  solids: readonly ManagedMapSolid[],
): MapSolidReconcileResult {
  const parsed = parseManagedMapSolids(solids) ?? [];
  const ranges = entityBlockRanges(text);
  const byTargetname = new Map<string, typeof ranges>();
  for (const range of ranges) {
    if (!range.entity.targetname) continue;
    const matches = byTargetname.get(range.entity.targetname) ?? [];
    matches.push(range);
    byTargetname.set(range.entity.targetname, matches);
  }
  let nextNodeId = maxNodeId(text) + 1;
  const replacements: { start: number; end: number; block: string }[] = [];
  const additions: string[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  for (const solid of parsed) {
    const matches = byTargetname.get(solid.targetname) ?? [];
    if (matches.length > 1) throw new Error(`Managed solid targetname is ambiguous in the map: ${solid.targetname}`);
    if (!matches.length) {
      additions.push(buildMapSolidBlock(solid, nextNodeId, nextNodeId + 1));
      nextNodeId += 2;
      added.push(solid.targetname);
      continue;
    }
    const existing = matches[0];
    if (solidBlockMatches(existing.block, solid)) {
      unchanged.push(solid.targetname);
      continue;
    }
    const nodeIds = [...existing.block.matchAll(/"nodeID"\s+"int"\s+"(\d+)"/g)]
      .map((match) => Number(match[1]));
    replacements.push({
      start: existing.start,
      end: existing.end,
      block: buildMapSolidBlock(solid, nodeIds[0] ?? nextNodeId++, nodeIds[1] ?? nextNodeId++),
    });
    updated.push(solid.targetname);
  }
  let out = text;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, replacement.start) + replacement.block + out.slice(replacement.end);
  }
  for (const block of additions) out = insertEntity(out, block);
  return { text: out, added, updated, unchanged };
}
