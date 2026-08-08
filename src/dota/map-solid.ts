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

export const managedMapSolidFaceMaterialsInputSchema = z.object({
  top: material.optional(),
  bottom: material.optional(),
}).strict().refine((value) => value.top !== undefined || value.bottom !== undefined, {
  message: "must override top, bottom, or both",
});

export function signedPolygonArea(points: readonly [number, number][]): number {
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

export function pointOnSegment(
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

export function segmentsTouchOrIntersect(
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

export function simplePolygonError(points: readonly [number, number][]): string | undefined {
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

const solidExtrusionInputSchema = z.union([
  z.object({
    points: z.array(point2).min(3).max(128),
    height: z.number().finite().positive().max(32768),
  }).strict(),
  z.object({
    points: z.array(point2).min(3).max(128),
    bottom: z.array(z.number().finite()).min(3).max(128),
    top: z.array(z.number().finite()).min(3).max(128),
  }).strict(),
]);

export const managedMapSolidInputSchema = z.object({
  targetname: safeName,
  center: point3,
  yaw: z.number().finite().optional(),
  material,
  faceMaterials: managedMapSolidFaceMaterialsInputSchema.optional(),
  extrusion: solidExtrusionInputSchema,
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
  if ("top" in solid.extrusion && solid.extrusion.top !== undefined && solid.extrusion.bottom !== undefined) {
    const sloped = solid.extrusion;
    for (const side of ["bottom", "top"] as const) {
      if (sloped[side].length !== sloped.points.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["extrusion", side],
          message: "must contain one local height for every outline point",
        });
      }
      sloped[side].forEach((height, index) => {
        if (Math.abs(height) > 16384) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["extrusion", side, index],
            message: "local heights must stay within +/-16384 world units",
          });
        }
      });
    }
    sloped.points.forEach((_point, index) => {
      const thickness = sloped.top[index] - sloped.bottom[index];
      if (!(thickness > 0) || thickness > 32768) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["extrusion", "top", index],
          message: "must be above the matching bottom height by at most 32768 world units",
        });
      }
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
  faceMaterials?: { top?: string; bottom?: string };
  extrusion:
    | { points: [number, number][]; height: number; bottom?: never; top?: never }
    | { points: [number, number][]; height?: never; bottom: number[]; top: number[] };
  properties?: Record<string, string>;
}

export interface MapSolidFaceMaterialPlan {
  materials: string[];
  faceMaterialIndices: number[];
}

/** Assign one checked material index to every generated top, bottom, and side triangle. */
export function mapSolidFaceMaterialPlan(solid: ManagedMapSolid): MapSolidFaceMaterialPlan {
  const sideMaterial = solid.material;
  const topMaterial = solid.faceMaterials?.top ?? sideMaterial;
  const bottomMaterial = solid.faceMaterials?.bottom ?? sideMaterial;
  const materials = [sideMaterial, topMaterial, bottomMaterial]
    .filter((value, index, all) => all.indexOf(value) === index);
  const topFaceCount = solid.extrusion.points.length - 2;
  const bottomFaceCount = topFaceCount;
  const sideFaceCount = solid.extrusion.points.length * 2;
  return {
    materials,
    faceMaterialIndices: [
      ...Array(topFaceCount).fill(materials.indexOf(topMaterial)),
      ...Array(bottomFaceCount).fill(materials.indexOf(bottomMaterial)),
      ...Array(sideFaceCount).fill(materials.indexOf(sideMaterial)),
    ],
  };
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
    const reverse = signedPolygonArea(points) < 0;
    if (reverse) points.reverse();
    const extrusion = "height" in solid.extrusion
      ? { points, height: solid.extrusion.height! }
      : {
          points,
          bottom: reverse ? [...solid.extrusion.bottom].reverse() : [...solid.extrusion.bottom],
          top: reverse ? [...solid.extrusion.top].reverse() : [...solid.extrusion.top],
        };
    return {
      ...solid,
      center: [...solid.center],
      ...(solid.faceMaterials ? { faceMaterials: { ...solid.faceMaterials } } : {}),
      extrusion,
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
  const { points } = parsed.extrusion;
  const bottom = "height" in parsed.extrusion
    ? points.map(() => -parsed.extrusion.height! / 2)
    : parsed.extrusion.bottom;
  const top = "height" in parsed.extrusion
    ? points.map(() => parsed.extrusion.height! / 2)
    : parsed.extrusion.top;
  const count = points.length;
  const vertices: MeshPoint3[] = [
    ...points.map(([x, y], index) => [x, y, top[index]] as MeshPoint3),
    ...points.map(([x, y], index) => [x, y, bottom[index]] as MeshPoint3),
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
  const materialPlan = mapSolidFaceMaterialPlan(parsed);
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
    materials: materialPlan.materials,
    faceMaterialIndices: materialPlan.faceMaterialIndices,
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

function blockMaterials(block: string): string[] | undefined {
  const match = /"materials"\s+"string_array"\s*\[([\s\S]*?)\]/.exec(block);
  if (!match) return undefined;
  const materials = [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((entry) => entry[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  return materials.length ? materials : undefined;
}

function blockFaceMaterialIndices(block: string): number[] | undefined {
  const match = /"standardAttributeName"\s+"string"\s+"materialindex"[\s\S]*?"data"\s+"int_array"\s*\[([\s\S]*?)\]/
    .exec(block);
  return match
    ? [...match[1].matchAll(/"(-?\d+)"/g)].map((entry) => Number(entry[1]))
    : undefined;
}

function sameNumbers(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameStrings(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
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
  const mesh = buildExtrudedSolidMesh(desired);
  const materialPlan = mapSolidFaceMaterialPlan(desired);
  if (!sameStrings(blockMaterials(block), materialPlan.materials)) return false;
  if (!sameNumbers(blockFaceMaterialIndices(block), materialPlan.faceMaterialIndices)) return false;
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
  faceMaterials?: { top?: string; bottom?: string };
  footprint: [number, number][];
  height?: number;
  sloped?: { bottom: number[]; top: number[] };
  blocking: true;
}

/** Read generated-style flat or sloped solid extrusions from VMAP text for inspection and preview. */
export function parseMapSolids(text: string): ParsedMapSolid[] {
  const parsed: ParsedMapSolid[] = [];
  for (const range of entityBlockRanges(text)) {
    const entity = range.entity;
    const vertices = positionVertices(range.block);
    const center = parseVector(entity.origin);
    const angles = parseVector(entity.angles) ?? [0, 0, 0];
    const materialPaths = blockMaterials(range.block);
    const materialPath = materialPaths?.[0];
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
    const topHeights = top.map((vertex) => vertex[2]);
    const bottomHeights = bottom.map((vertex) => vertex[2]);
    if (topHeights.some((height, index) => height <= bottomHeights[index])) continue;
    const flat = topHeights.every((height) => Math.abs(height - topHeights[0]) <= 1e-4) &&
      bottomHeights.every((height) => Math.abs(height - bottomHeights[0]) <= 1e-4) &&
      Math.abs(topHeights[0] + bottomHeights[0]) <= 1e-4;
    const topFaceCount = count - 2;
    const faceIndices = blockFaceMaterialIndices(range.block) ?? Array(4 * count - 4).fill(0);
    if (
      faceIndices.length !== 4 * count - 4 ||
      faceIndices.some((index) => index < 0 || index >= materialPaths!.length)
    ) continue;
    const uniformRoleMaterial = (start: number, length: number): string | undefined => {
      const role = faceIndices.slice(start, start + length);
      return role.length === length && role.every((index) => index === role[0])
        ? materialPaths![role[0]]
        : undefined;
    };
    const topMaterial = uniformRoleMaterial(0, topFaceCount);
    const bottomMaterial = uniformRoleMaterial(topFaceCount, topFaceCount);
    const sideMaterial = uniformRoleMaterial(topFaceCount * 2, count * 2);
    if (!topMaterial || !bottomMaterial || sideMaterial !== materialPath) continue;
    const faceMaterials = {
      ...(topMaterial !== materialPath ? { top: topMaterial } : {}),
      ...(bottomMaterial !== materialPath ? { bottom: bottomMaterial } : {}),
    };
    parsed.push({
      targetname: entity.targetname,
      center,
      yaw: angles[1],
      material: materialPath,
      ...(Object.keys(faceMaterials).length ? { faceMaterials } : {}),
      footprint: top.map(([x, y]) => [x, y]),
      ...(flat
        ? { height: topHeights[0] - bottomHeights[0] }
        : { sloped: { bottom: bottomHeights, top: topHeights } }),
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
