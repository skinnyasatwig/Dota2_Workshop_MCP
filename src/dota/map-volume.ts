import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildMapMeshNode, MapMeshData, numberText, vectorText } from "./map-mesh.js";
import { entityBlockRanges, insertEntity, maxNodeId, parseMapEntities } from "./vmap.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const point2 = z.tuple([z.number().finite(), z.number().finite()]);
const point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const mapVolumeRecipeSchema = z.enum([
  "camp",
  "trigger",
  "heroTrigger",
  "dotaTrigger",
  "bossAttackable",
  "noWards",
  "playerClip",
]);

const managedMapVolumeCommonInputSchema = z.object({
  targetname: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
  recipe: mapVolumeRecipeSchema,
  center: point3,
  yaw: z.number().finite().optional(),
  properties: z.record(scalar).optional(),
});

const polygonPrismInputSchema = z.union([
  z.object({
    points: z.array(point2).min(3).max(64),
    height: z.number().finite().positive().max(32768),
  }).strict(),
  z.object({
    points: z.array(point2).min(3).max(64),
    bottom: z.array(z.number().finite()).min(3).max(64),
    top: z.array(z.number().finite()).min(3).max(64),
  }).strict(),
]);

export const managedMapVolumeInputSchema = z.union([
  managedMapVolumeCommonInputSchema.extend({ size: point3 }).strict(),
  managedMapVolumeCommonInputSchema.extend({ polygon: polygonPrismInputSchema }).strict(),
]).superRefine((volume, context) => {
  if ("size" in volume) {
    volume.size.forEach((value, axis) => {
      if (value <= 0 || value > 32768) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["size", axis],
          message: "must be greater than 0 and at most 32768 world units",
        });
      }
    });
  } else {
    const polygonError = convexPolygonError(volume.polygon.points);
    if (polygonError) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["polygon", "points"],
        message: polygonError,
      });
    }
    if ("top" in volume.polygon && volume.polygon.top !== undefined && volume.polygon.bottom !== undefined) {
      const sloped = volume.polygon;
      for (const side of ["bottom", "top"] as const) {
        if (sloped[side].length !== sloped.points.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["polygon", side],
            message: "must contain one local height for every polygon point",
          });
        }
        if (sloped[side].some((height) => Math.abs(height) > 16384)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["polygon", side],
            message: "local heights must stay within +/-16384 world units",
          });
        }
        const planeError = coplanarRingError(sloped.points, sloped[side]);
        if (planeError) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["polygon", side],
            message: planeError,
          });
        }
      }
      sloped.points.forEach((_point, index) => {
        const thickness = sloped.top[index] - sloped.bottom[index];
        if (!(thickness > 0) || thickness > 32768) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["polygon", "top", index],
            message: "must be above the matching bottom height by at most 32768 world units",
          });
        }
      });
    }
  }
  for (const reserved of ["classname", "targetname", "origin", "angles", "source1_brushmodel_index"]) {
    if (volume.properties?.[reserved] !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["properties", reserved],
        message: "is controlled by the checked volume recipe",
      });
    }
  }
});

export type MapVolumeRecipe = z.infer<typeof mapVolumeRecipeSchema>;
interface ManagedMapVolumeCommon {
  targetname: string;
  recipe: MapVolumeRecipe;
  center: [number, number, number];
  yaw?: number;
  properties?: Record<string, string>;
}

export type ManagedMapVolume = ManagedMapVolumeCommon & (
  | { size: [number, number, number]; polygon?: never }
  | {
      size?: never;
      polygon:
        | { points: [number, number][]; height: number; bottom?: never; top?: never }
        | { points: [number, number][]; height?: never; bottom: number[]; top: number[] };
    }
);

export interface MapVolumeRecipeDefinition {
  classname: string;
  material: string;
  properties: Record<string, string>;
  purpose: string;
}

export const MAP_VOLUME_RECIPES: Readonly<Record<MapVolumeRecipe, MapVolumeRecipeDefinition>> = {
  camp: {
    classname: "trigger_multiple",
    material: "materials/tools/toolstrigger.vmat",
    properties: { StartDisabled: "0", spawnflags: "64", wait: "1" },
    purpose: "Neutral-camp spawn boundary referenced by npc_dota_neutral_spawner.VolumeName.",
  },
  trigger: {
    classname: "trigger_multiple",
    material: "materials/tools/toolstrigger.vmat",
    properties: { StartDisabled: "0", spawnflags: "64", wait: "1" },
    purpose: "General repeatable Source 2 trigger volume.",
  },
  heroTrigger: {
    classname: "trigger_hero",
    material: "materials/tools/toolstrigger.vmat",
    properties: { StartDisabled: "0", spawnflags: "64", wait: "1" },
    purpose: "Dota trigger that responds to heroes.",
  },
  dotaTrigger: {
    classname: "trigger_dota",
    material: "materials/tools/toolstrigger.vmat",
    properties: { StartDisabled: "0", wait: "1" },
    purpose: "Dota-filter-aware trigger volume.",
  },
  bossAttackable: {
    classname: "trigger_boss_attackable",
    material: "materials/tools/toolstrigger.vmat",
    properties: { StartDisabled: "0", spawnflags: "64" },
    purpose: "Region from which a Dota boss may be attacked.",
  },
  noWards: {
    classname: "trigger_no_wards",
    material: "materials/tools/tools_no_wards.vmat",
    properties: { StartDisabled: "0", spawnflags: "64" },
    purpose: "Region in which wards are disallowed.",
  },
  playerClip: {
    classname: "func_brush",
    material: "materials/tools/toolsplayerclip.vmat",
    properties: { StartDisabled: "0", spawnflags: "2", Solidity: "2", solidbsp: "0" },
    purpose: "Always-solid invisible player collision prism.",
  },
};

function signedPolygonArea(points: readonly [number, number][]): number {
  return points.reduce((area, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length];
    return area + x * nextY - nextX * y;
  }, 0) / 2;
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -1e-8 && cdA * cdB < -1e-8;
}

function convexPolygonError(points: readonly [number, number][]): string | undefined {
  if (points.length < 3) return "must contain at least three points";
  const keys = points.map(([x, y]) => `${x}:${y}`);
  if (new Set(keys).size !== points.length) return "must not contain duplicate points";
  if (points.some(([x, y]) => Math.abs(x) > 16384 || Math.abs(y) > 16384)) {
    return "coordinates must stay within +/-16384 local world units";
  }
  if (Math.abs(signedPolygonArea(points)) <= 1) return "must enclose a non-zero area";
  for (let first = 0; first < points.length; first++) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second++) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return "must not self-intersect";
      }
    }
  }
  let turn = 0;
  for (let index = 0; index < points.length; index++) {
    const cross = orientation(points[index], points[(index + 1) % points.length], points[(index + 2) % points.length]);
    if (Math.abs(cross) <= 1e-8) return "must not contain collinear adjacent edges";
    const sign = Math.sign(cross);
    if (turn && sign !== turn) return "must be convex";
    turn = sign;
  }
  return undefined;
}

function coplanarRingError(
  points: readonly [number, number][],
  heights: readonly number[],
): string | undefined {
  if (points.length !== heights.length || points.length < 3) return "must define a complete plane";
  const [a, b, c] = [0, 1, 2].map((index) => [
    points[index][0],
    points[index][1],
    heights[index],
  ] as [number, number, number]);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...normal);
  if (length <= 1e-8 || Math.abs(normal[2]) <= 1e-8) return "must define a non-vertical plane";
  const tolerance = 1e-4 * Math.max(1, length);
  for (let index = 3; index < points.length; index++) {
    const delta = [
      points[index][0] - a[0],
      points[index][1] - a[1],
      heights[index] - a[2],
    ];
    if (Math.abs(normal[0] * delta[0] + normal[1] * delta[1] + normal[2] * delta[2]) > tolerance) {
      return "must be coplanar (twisted top or bottom faces are unsafe)";
    }
  }
  return undefined;
}

function normalizedPolygon(points: readonly [number, number][]): [number, number][] {
  const copied = points.map(([x, y]) => [x, y] as [number, number]);
  return signedPolygonArea(copied) < 0 ? copied.reverse() : copied;
}

/**
 * Build a regular convex footprint for JSON generators and reusable components.
 * Circumscribed mode treats radius as the minimum distance from center to every
 * polygon edge, which is appropriate for no-ward and collision guarantees.
 */
export function regularPolygonFootprint(
  radius: number,
  sides = 32,
  circumscribed = false,
): [number, number][] {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("regular polygon radius must be positive");
  if (!Number.isInteger(sides) || sides < 3 || sides > 64) {
    throw new Error("regular polygon sides must be an integer from 3 through 64");
  }
  const vertexRadius = circumscribed ? radius / Math.cos(Math.PI / sides) : radius;
  return Array.from({ length: sides }, (_unused, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return [Math.cos(angle) * vertexRadius, Math.sin(angle) * vertexRadius];
  });
}

export function parseManagedMapVolumes(
  value: unknown,
  field = "managedVolumes",
  path = "inline map specification",
): ManagedMapVolume[] | undefined {
  if (value === undefined) return undefined;
  const result = z.array(managedMapVolumeInputSchema).safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${field}${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`)
      .join("; ");
    throw new Error(`${details}: ${path}`);
  }
  return result.data.map((volume) => {
    if ("size" in volume) {
      return {
        ...volume,
        center: [...volume.center],
        size: [...volume.size] as [number, number, number],
        properties: volume.properties
          ? Object.fromEntries(Object.entries(volume.properties).map(([key, property]) => [key, String(property)]))
          : undefined,
      };
    }
    const reverse = signedPolygonArea(volume.polygon.points) < 0;
    const points = normalizedPolygon(volume.polygon.points);
    const polygon = "height" in volume.polygon
      ? { points, height: volume.polygon.height }
      : {
          points,
          bottom: reverse ? [...volume.polygon.bottom].reverse() : [...volume.polygon.bottom],
          top: reverse ? [...volume.polygon.top].reverse() : [...volume.polygon.top],
        };
    return {
      ...volume,
      center: [...volume.center],
      polygon,
      properties: volume.properties
        ? Object.fromEntries(Object.entries(volume.properties).map(([key, property]) => [key, String(property)]))
        : undefined,
    };
  }) as ManagedMapVolume[];
}

function escaped(value: string | number): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface VolumeGeometry {
  points: [number, number][];
  bottom: number[];
  top: number[];
}

function volumeGeometry(volume: ManagedMapVolume): VolumeGeometry {
  if (volume.size !== undefined) {
    const [width, depth, height] = volume.size;
    const points: [number, number][] = [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [width / 2, depth / 2],
      [-width / 2, depth / 2],
    ];
    return {
      points,
      bottom: points.map(() => -height / 2),
      top: points.map(() => height / 2),
    };
  }
  const points = normalizedPolygon(volume.polygon.points);
  if (volume.polygon.height !== undefined) {
    return {
      points,
      bottom: points.map(() => -volume.polygon.height! / 2),
      top: points.map(() => volume.polygon.height! / 2),
    };
  }
  return { points, bottom: [...volume.polygon.bottom], top: [...volume.polygon.top] };
}

function normalizedVector(vector: readonly number[]): [number, number, number] {
  const length = Math.hypot(...vector);
  if (length <= 1e-8) throw new Error("Cannot normalize a zero-length volume face vector.");
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function faceNormal(
  points: readonly [number, number][],
  heights: readonly number[],
  upward: boolean,
): [number, number, number] {
  const [a, b, c] = [0, 1, 2].map((index) => [points[index][0], points[index][1], heights[index]]);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = normalizedVector([
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]);
  const direction = upward === (normal[2] > 0) ? 1 : -1;
  return normal.map((value) => value * direction) as [number, number, number];
}

function buildPrismMesh(geometry: VolumeGeometry): MapMeshData {
  const { points, bottom, top } = geometry;
  const count = points.length;
  const vertices = [
    ...points.map(([x, y], index) => vectorText([x, y, top[index]])),
    ...points.map(([x, y], index) => vectorText([x, y, bottom[index]])),
  ];
  const starts: number[] = [];
  const ends: number[] = [];
  const opposites: number[] = [];
  const addPair = (start: number, end: number): [number, number] => {
    const forward = starts.length;
    const reverse = forward + 1;
    starts.push(start, end);
    ends.push(end, start);
    opposites.push(reverse, forward);
    return [forward, reverse];
  };
  const topForward: number[] = [];
  const topReverse: number[] = [];
  const bottomReverse: number[] = [];
  const bottomForward: number[] = [];
  const down: number[] = [];
  const up: number[] = [];
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    const top = addPair(index, next);
    topForward.push(top[0]);
    topReverse.push(top[1]);
    const bottom = addPair(count + next, count + index);
    bottomReverse.push(bottom[0]);
    bottomForward.push(bottom[1]);
    const vertical = addPair(index, count + index);
    down.push(vertical[0]);
    up.push(vertical[1]);
  }
  const faces: number[][] = [
    topForward,
    [...bottomReverse].reverse(),
    ...points.map((_point, index) => [
      topReverse[index],
      down[index],
      bottomForward[index],
      up[(index + 1) % count],
    ]),
  ];
  const edgeNextIndices = new Array(starts.length).fill(-1);
  const edgeFaceIndices = new Array(starts.length).fill(-1);
  for (const [faceIndex, edges] of faces.entries()) {
    for (const [edgeIndex, edge] of edges.entries()) {
      edgeNextIndices[edge] = edges[(edgeIndex + 1) % edges.length];
      edgeFaceIndices[edge] = faceIndex;
    }
  }
  const topTangent = normalizedVector([
    points[1][0] - points[0][0],
    points[1][1] - points[0][1],
    top[1] - top[0],
  ]);
  const bottomTangent = normalizedVector([
    points[1][0] - points[0][0],
    points[1][1] - points[0][1],
    bottom[1] - bottom[0],
  ]);
  const faceNormals: [number, number, number][] = [
    faceNormal(points, top, true),
    faceNormal(points, bottom, false),
  ];
  const faceTangents: [number, number, number, number][] = [
    [...topTangent, -1],
    [...bottomTangent, 1],
  ];
  for (let index = 0; index < count; index++) {
    const [x, y] = points[index];
    const [nextX, nextY] = points[(index + 1) % count];
    const dx = nextX - x;
    const dy = nextY - y;
    const length = Math.hypot(dx, dy);
    faceNormals.push([dy / length, -dx / length, 0]);
    faceTangents.push([dx / length, dy / length, 0, -1]);
  }
  const normals = edgeFaceIndices.map((face) => vectorText(faceNormals[face]));
  const tangents = edgeFaceIndices.map((face) => vectorText(faceTangents[face]));
  const textureAxisU = faceTangents.map(([x, y, z]) => vectorText([x, y, z, 32]));
  const textureAxisV = faceTangents.map(([tx, ty, tz], face) => {
    if (face >= 2) return "0 0 -1 0";
    const [nx, ny, nz] = faceNormals[face];
    const axis = normalizedVector([
      ty * nz - tz * ny,
      tz * nx - tx * nz,
      tx * ny - ty * nx,
    ]);
    return vectorText([...axis, 32]);
  });
  return {
    vertices,
    vertexEdgeIndices: Array.from({ length: vertices.length }, (_unused, vertex) =>
      starts.findIndex((start) => start === vertex)),
    vertexDataIndices: Array.from({ length: vertices.length }, (_unused, index) => index),
    edgeVertexIndices: ends,
    edgeOppositeIndices: opposites,
    edgeNextIndices,
    edgeFaceIndices,
    edgeDataIndices: Array.from({ length: starts.length }, (_unused, index) => Math.floor(index / 2)),
    edgeVertexDataIndices: Array.from({ length: starts.length }, (_unused, index) => index),
    faceEdgeIndices: faces.map((edges) => edges[0]),
    faceDataIndices: faces.map((_edges, index) => index),
    normals,
    tangents,
    textureAxisU,
    textureAxisV,
  };
}

export function buildMapVolumeBlock(
  volume: ManagedMapVolume,
  entityNodeId: number,
  meshNodeId = entityNodeId + 1,
): string {
  const parsed = parseManagedMapVolumes([volume])![0];
  const recipe = MAP_VOLUME_RECIPES[parsed.recipe];
  const geometry = volumeGeometry(parsed);
  const mesh = buildPrismMesh(geometry);
  const mergedProperties = {
    ...recipe.properties,
    ...(parsed.properties ?? {}),
    targetname: parsed.targetname,
  };
  const propertyLines = Object.entries(mergedProperties)
    .map(([key, value]) => `\t\t"${escaped(key)}" "string" "${escaped(value)}"`)
    .join("\n");
  const origin = vectorText(parsed.center);
  const yaw = numberText(((parsed.yaw ?? 0) % 360 + 360) % 360);
  const meshNode = buildMapMeshNode(mesh, {
    nodeId: meshNodeId,
    origin: parsed.center,
    yaw: parsed.yaw,
    material: recipe.material,
  }).split("\n").map((line) => `\t\t${line}`).join("\n");

  return `"CMapEntity"
{
	"id" "elementid" "${randomUUID()}"
	"origin" "vector3" "${origin}"
	"angles" "qangle" "0 ${yaw} 0"
	"scales" "vector3" "1 1 1"
	"nodeID" "int" "${entityNodeId}"
	"children" "element_array"
	[
${meshNode}
	]
	"editorOnly" "bool" "0"
	"force_hidden" "bool" "0"
	"variableTargetKeys" "string_array" [ ]
	"variableNames" "string_array" [ ]
	"relayPlugData" "DmePlugList"
	{
		"id" "elementid" "${randomUUID()}"
		"names" "string_array" [ ]
		"dataTypes" "int_array" [ ]
		"plugTypes" "int_array" [ ]
		"descriptions" "string_array" [ ]
	}
	"connectionsData" "element_array" [ ]
	"entity_properties" "EditGameClassProps"
	{
		"id" "elementid" "${randomUUID()}"
		"classname" "string" "${recipe.classname}"
${propertyLines}
	}
	"hitNormal" "vector3" "0 0 1"
	"isProceduralEntity" "bool" "0"
}`;
}

export function buildBoxVolumeBlock(
  volume: ManagedMapVolume,
  entityNodeId: number,
  meshNodeId = entityNodeId + 1,
): string {
  const parsed = parseManagedMapVolumes([volume])![0];
  if (!("size" in parsed)) throw new Error("buildBoxVolumeBlock requires a size-based box volume.");
  return buildMapVolumeBlock(parsed, entityNodeId, meshNodeId);
}

export function buildPolygonVolumeBlock(
  volume: ManagedMapVolume,
  entityNodeId: number,
  meshNodeId = entityNodeId + 1,
): string {
  const parsed = parseManagedMapVolumes([volume])![0];
  if (!("polygon" in parsed)) throw new Error("buildPolygonVolumeBlock requires a polygon prism volume.");
  return buildMapVolumeBlock(parsed, entityNodeId, meshNodeId);
}

function parseVector(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const numbers = value.trim().split(/\s+/).map(Number);
  return numbers.length === 3 && numbers.every(Number.isFinite)
    ? numbers as [number, number, number]
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

function blockMaterial(block: string): string | undefined {
  return /"materials"\s+"string_array"\s*\[\s*"([^"]+)"/.exec(block)?.[1];
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-4;
}

function expectedVolumeVertices(volume: ManagedMapVolume): [number, number, number][] {
  return buildPrismMesh(volumeGeometry(volume)).vertices
    .map((vertex) => parseVector(vertex))
    .filter((vertex): vertex is [number, number, number] => !!vertex);
}

function sameVertexSet(
  actual: readonly [number, number, number][],
  expected: readonly [number, number, number][],
): boolean {
  if (actual.length !== expected.length) return false;
  const unmatched = [...actual];
  for (const vertex of expected) {
    const match = unmatched.findIndex((candidate) =>
      candidate.every((value, axis) => closeEnough(value, vertex[axis])));
    if (match < 0) return false;
    unmatched.splice(match, 1);
  }
  return true;
}

function parsedPrismGeometry(vertices: readonly [number, number, number][]): VolumeGeometry | undefined {
  const pairs: { point: [number, number]; bottom: number; top: number }[] = [];
  for (const [x, y, z] of vertices) {
    const existing = pairs.find((pair) => closeEnough(pair.point[0], x) && closeEnough(pair.point[1], y));
    if (!existing) {
      pairs.push({ point: [x, y], bottom: z, top: z });
      continue;
    }
    if (!closeEnough(existing.bottom, existing.top)) return undefined;
    existing.bottom = Math.min(existing.bottom, z);
    existing.top = Math.max(existing.top, z);
  }
  if (pairs.length < 3 || pairs.length * 2 !== vertices.length) return undefined;
  if (pairs.some((pair) => !Number.isFinite(pair.bottom) || !(pair.top > pair.bottom))) return undefined;
  const centerX = pairs.reduce((sum, pair) => sum + pair.point[0], 0) / pairs.length;
  const centerY = pairs.reduce((sum, pair) => sum + pair.point[1], 0) / pairs.length;
  pairs.sort((a, b) =>
    Math.atan2(a.point[1] - centerY, a.point[0] - centerX) -
    Math.atan2(b.point[1] - centerY, b.point[0] - centerX));
  if (signedPolygonArea(pairs.map((pair) => pair.point)) < 0) pairs.reverse();
  const geometry = {
    points: pairs.map((pair) => pair.point),
    bottom: pairs.map((pair) => pair.bottom),
    top: pairs.map((pair) => pair.top),
  };
  if (
    convexPolygonError(geometry.points) ||
    coplanarRingError(geometry.points, geometry.bottom) ||
    coplanarRingError(geometry.points, geometry.top)
  ) return undefined;
  return geometry;
}

function volumeBlockMatches(block: string, desired: ManagedMapVolume): boolean {
  const entity = parseMapEntities(block)[0];
  const recipe = MAP_VOLUME_RECIPES[desired.recipe];
  if (!entity || entity.classname !== recipe.classname || entity.targetname !== desired.targetname) return false;
  const center = parseVector(entity.origin);
  const angles = parseVector(entity.angles);
  const vertices = positionVertices(block);
  if (!center || !angles || !vertices || blockMaterial(block) !== recipe.material) return false;
  if (!center.every((value, axis) => closeEnough(value, desired.center[axis]))) return false;
  const yaw = ((desired.yaw ?? 0) % 360 + 360) % 360;
  if (!closeEnough(angles[0], 0) || !closeEnough(angles[1], yaw) || !closeEnough(angles[2], 0)) return false;
  if (!sameVertexSet(vertices, expectedVolumeVertices(desired))) return false;
  const properties = { ...recipe.properties, ...(desired.properties ?? {}) };
  return Object.entries(properties).every(([key, value]) => entity.properties[key] === value);
}

export interface MapVolumeReconcileResult {
  text: string;
  added: string[];
  updated: string[];
  unchanged: string[];
}

export interface ParsedMapVolume {
  targetname: string;
  classname: string;
  recipe: MapVolumeRecipe;
  center: [number, number, number];
  size: [number, number, number];
  /** Convex local-space footprint in counter-clockwise order. */
  footprint: [number, number][];
  /** Present when either the local top or bottom face is sloped. */
  sloped?: { bottom: number[]; top: number[] };
  yaw: number;
  material: string;
  blocking: boolean;
}

/** @deprecated Use ParsedMapVolume. Retained for callers compiled against the box-only milestone. */
export type ParsedMapBoxVolume = ParsedMapVolume;

function inferredRecipe(
  classname: string,
  material: string,
  targetname: string,
): MapVolumeRecipe | undefined {
  if (material === MAP_VOLUME_RECIPES.playerClip.material) return "playerClip";
  if (classname === MAP_VOLUME_RECIPES.noWards.classname) return "noWards";
  if (classname === MAP_VOLUME_RECIPES.bossAttackable.classname) return "bossAttackable";
  if (classname === MAP_VOLUME_RECIPES.heroTrigger.classname) return "heroTrigger";
  if (classname === MAP_VOLUME_RECIPES.dotaTrigger.classname) return "dotaTrigger";
  if (classname === MAP_VOLUME_RECIPES.trigger.classname && material === MAP_VOLUME_RECIPES.trigger.material) {
    return /(?:^|_)camp(?:_|$)/i.test(targetname) ? "camp" : "trigger";
  }
  return undefined;
}

/** Read checked or Valve-authored convex vertical-sided tool volumes from VMAP text. */
export function parseMapVolumes(text: string): ParsedMapVolume[] {
  const parsed: ParsedMapVolume[] = [];
  for (const range of entityBlockRanges(text)) {
    const center = parseVector(range.entity.origin);
    const angles = parseVector(range.entity.angles) ?? [0, 0, 0];
    const vertices = positionVertices(range.block);
    const material = blockMaterial(range.block);
    if (!center || !vertices || !material) continue;
    const targetname = range.entity.targetname ?? `unnamed_volume_${range.start}`;
    const recipe = inferredRecipe(range.entity.classname, material, targetname);
    if (!recipe) continue;
    const geometry = parsedPrismGeometry(vertices);
    if (!geometry) continue;
    const mins = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis])));
    const maxs = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis])));
    parsed.push({
      targetname,
      classname: range.entity.classname,
      recipe,
      center,
      size: [maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]],
      footprint: geometry.points,
      ...(
        geometry.top.some((height, index) => !closeEnough(height, geometry.top[0]) ||
          !closeEnough(geometry.bottom[index], geometry.bottom[0]))
          ? { sloped: { bottom: geometry.bottom, top: geometry.top } }
          : {}
      ),
      yaw: angles[1],
      material,
      blocking: recipe === "playerClip",
    });
  }
  return parsed;
}


/** @deprecated Use parseMapVolumes. Retained for box-only API compatibility. */
export const parseMapBoxVolumes = parseMapVolumes;

export function reconcileMapVolumes(
  text: string,
  volumes: readonly ManagedMapVolume[],
): MapVolumeReconcileResult {
  const parsed = parseManagedMapVolumes(volumes) ?? [];
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
  for (const volume of parsed) {
    const matches = byTargetname.get(volume.targetname) ?? [];
    if (matches.length > 1) {
      throw new Error(`Managed volume targetname is ambiguous in the map: ${volume.targetname}`);
    }
    if (!matches.length) {
      additions.push(buildMapVolumeBlock(volume, nextNodeId, nextNodeId + 1));
      nextNodeId += 2;
      added.push(volume.targetname);
      continue;
    }
    const existing = matches[0];
    if (volumeBlockMatches(existing.block, volume)) {
      unchanged.push(volume.targetname);
      continue;
    }
    const nodeIds = [...existing.block.matchAll(/"nodeID"\s+"int"\s+"(\d+)"/g)].map((match) => Number(match[1]));
    replacements.push({
      start: existing.start,
      end: existing.end,
      block: buildMapVolumeBlock(volume, nodeIds[0] ?? nextNodeId++, nodeIds[1] ?? nextNodeId++),
    });
    updated.push(volume.targetname);
  }
  let out = text;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, replacement.start) + replacement.block + out.slice(replacement.end);
  }
  for (const block of additions) out = insertEntity(out, block);
  return { text: out, added, updated, unchanged };
}
