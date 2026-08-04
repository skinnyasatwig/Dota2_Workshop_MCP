import { randomUUID } from "node:crypto";
import { z } from "zod";
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

const polygonPrismInputSchema = z.object({
  points: z.array(point2).min(3).max(64),
  height: z.number().finite().positive().max(32768),
}).strict();

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
  | { size?: never; polygon: { points: [number, number][]; height: number } }
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
  return result.data.map((volume) => ({
    ...volume,
    center: [...volume.center],
    ...("size" in volume
      ? { size: [...volume.size] as [number, number, number] }
      : {
          polygon: {
            points: normalizedPolygon(volume.polygon.points),
            height: volume.polygon.height,
          },
        }),
    properties: volume.properties
      ? Object.fromEntries(Object.entries(volume.properties).map(([key, property]) => [key, String(property)]))
      : undefined,
  })) as ManagedMapVolume[];
}

function numberText(value: number): string {
  return String(Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6)));
}

function vectorText(vector: readonly number[]): string {
  return vector.map(numberText).join(" ");
}

function escaped(value: string | number): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function arrayValues(values: readonly (string | number)[], indent: string): string {
  return values.map((value) => `${indent}"${escaped(value)}"`).join(",\n");
}

interface PrismMeshData {
  vertices: string[];
  vertexEdgeIndices: number[];
  vertexDataIndices: number[];
  edgeVertexIndices: number[];
  edgeOppositeIndices: number[];
  edgeNextIndices: number[];
  edgeFaceIndices: number[];
  edgeDataIndices: number[];
  edgeVertexDataIndices: number[];
  faceEdgeIndices: number[];
  faceDataIndices: number[];
  normals: string[];
  tangents: string[];
  textureAxisU: string[];
  textureAxisV: string[];
}

function footprintAndHeight(volume: ManagedMapVolume): {
  points: [number, number][];
  height: number;
} {
  if (volume.size !== undefined) {
    const [width, depth, height] = volume.size;
    return {
      points: [
        [-width / 2, -depth / 2],
        [width / 2, -depth / 2],
        [width / 2, depth / 2],
        [-width / 2, depth / 2],
      ],
      height,
    };
  }
  return { points: normalizedPolygon(volume.polygon.points), height: volume.polygon.height };
}

function buildPrismMesh(points: readonly [number, number][], height: number): PrismMeshData {
  const count = points.length;
  const halfHeight = height / 2;
  const vertices = [
    ...points.map(([x, y]) => vectorText([x, y, halfHeight])),
    ...points.map(([x, y]) => vectorText([x, y, -halfHeight])),
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
  const faceNormals: [number, number, number][] = [[0, 0, 1], [0, 0, -1]];
  const faceTangents: [number, number, number, number][] = [[1, 0, 0, -1], [1, 0, 0, 1]];
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
  const textureAxisV = faceTangents.map((_tangent, face) =>
    face < 2 ? "0 -1 0 32" : "0 0 -1 0");
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

function dataStream(
  name: string,
  standardName: string,
  type: string,
  values: readonly (string | number)[],
  dataStateFlags: number,
): string {
  return `"CDmePolygonMeshDataStream"
{
	"id" "elementid" "${randomUUID()}"
	"name" "string" "${name}:0"
	"standardAttributeName" "string" "${standardName}"
	"semanticName" "string" "${standardName}"
	"semanticIndex" "int" "0"
	"vertexBufferLocation" "int" "0"
	"dataStateFlags" "int" "${dataStateFlags}"
	"subdivisionBinding" "element" ""
	"data" "${type}_array"
	[
${arrayValues(values, "\t\t")}
	]
}`;
}

function dataArray(size: number, streams: readonly string[]): string {
  return `"CDmePolygonMeshDataArray"
{
	"id" "elementid" "${randomUUID()}"
	"size" "int" "${size}"
	"streams" "element_array"
	[
${streams.map((stream) => stream.split("\n").map((line) => `\t\t${line}`).join("\n")).join(",\n")}
	]
}`;
}

export function buildMapVolumeBlock(
  volume: ManagedMapVolume,
  entityNodeId: number,
  meshNodeId = entityNodeId + 1,
): string {
  const parsed = parseManagedMapVolumes([volume])![0];
  const recipe = MAP_VOLUME_RECIPES[parsed.recipe];
  const geometry = footprintAndHeight(parsed);
  const mesh = buildPrismMesh(geometry.points, geometry.height);
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
  const vertexData = dataArray(mesh.vertices.length, [
    dataStream("position", "position", "vector3", mesh.vertices, 3),
  ]);
  const faceVertexData = dataArray(mesh.edgeVertexIndices.length, [
    dataStream("texcoord", "texcoord", "vector2", Array(mesh.edgeVertexIndices.length).fill("0 0"), 1),
    dataStream("normal", "normal", "vector3", mesh.normals, 1),
    dataStream("tangent", "tangent", "vector4", mesh.tangents, 1),
  ]);
  const edgeCount = mesh.edgeVertexIndices.length / 2;
  const faceCount = mesh.faceEdgeIndices.length;
  const edgeData = dataArray(edgeCount, [dataStream("flags", "flags", "int", Array(edgeCount).fill(0), 3)]);
  const faceData = dataArray(faceCount, [
    dataStream("textureScale", "textureScale", "vector2", Array(faceCount).fill("1 1"), 0),
    dataStream("textureAxisU", "textureAxisU", "vector4", mesh.textureAxisU, 0),
    dataStream("textureAxisV", "textureAxisV", "vector4", mesh.textureAxisV, 0),
    dataStream("materialindex", "materialindex", "int", Array(faceCount).fill(0), 8),
    dataStream("flags", "flags", "int", Array(faceCount).fill(0), 3),
  ]);

  return `"CMapEntity"
{
	"id" "elementid" "${randomUUID()}"
	"origin" "vector3" "${origin}"
	"angles" "qangle" "0 ${yaw} 0"
	"scales" "vector3" "1 1 1"
	"nodeID" "int" "${entityNodeId}"
	"children" "element_array"
	[
		"CMapMesh"
		{
			"id" "elementid" "${randomUUID()}"
			"origin" "vector3" "${origin}"
			"angles" "qangle" "0 ${yaw} 0"
			"scales" "vector3" "1 1 1"
			"nodeID" "int" "${meshNodeId}"
			"children" "element_array" [ ]
			"editorOnly" "bool" "0"
			"force_hidden" "bool" "0"
			"variableTargetKeys" "string_array" [ ]
			"variableNames" "string_array" [ ]
			"cubeMapName" "string" ""
			"fademindist" "float" "-1"
			"fademaxdist" "float" "0"
			"smoothingAngle" "float" "40"
			"tintColor" "color" "255 255 255 255"
			"physicsType" "string" "default"
			"physicsGroup" "string" ""
			"physicsInteractsAs" "string" ""
			"physicsInteractsWith" "string" ""
			"meshData" "CDmePolygonMesh"
			{
				"id" "elementid" "${randomUUID()}"
				"name" "string" "meshData"
				"vertexEdgeIndices" "int_array" [ ${arrayValues(mesh.vertexEdgeIndices, "")} ]
				"vertexDataIndices" "int_array" [ ${arrayValues(mesh.vertexDataIndices, "")} ]
				"edgeVertexIndices" "int_array" [ ${arrayValues(mesh.edgeVertexIndices, "")} ]
				"edgeOppositeIndices" "int_array" [ ${arrayValues(mesh.edgeOppositeIndices, "")} ]
				"edgeNextIndices" "int_array" [ ${arrayValues(mesh.edgeNextIndices, "")} ]
				"edgeFaceIndices" "int_array" [ ${arrayValues(mesh.edgeFaceIndices, "")} ]
				"edgeDataIndices" "int_array" [ ${arrayValues(mesh.edgeDataIndices, "")} ]
				"edgeVertexDataIndices" "int_array" [ ${arrayValues(mesh.edgeVertexDataIndices, "")} ]
				"faceEdgeIndices" "int_array" [ ${arrayValues(mesh.faceEdgeIndices, "")} ]
				"faceDataIndices" "int_array" [ ${arrayValues(mesh.faceDataIndices, "")} ]
				"materials" "string_array" [ "${recipe.material}" ]
				"vertexData" ${vertexData.split("\n").map((line) => `\t\t\t\t${line}`).join("\n").trimStart()}
				"faceVertexData" ${faceVertexData.split("\n").map((line) => `\t\t\t\t${line}`).join("\n").trimStart()}
				"edgeData" ${edgeData.split("\n").map((line) => `\t\t\t\t${line}`).join("\n").trimStart()}
				"faceData" ${faceData.split("\n").map((line) => `\t\t\t\t${line}`).join("\n").trimStart()}
				"subdivisionData" "CDmePolygonMeshSubdivisionData"
				{
					"id" "elementid" "${randomUUID()}"
					"subdivisionLevels" "int_array" [ ${arrayValues(Array(mesh.edgeVertexIndices.length).fill(0), "")} ]
					"streams" "element_array" [ ]
				}
			}
			"useAsOccluder" "bool" "0"
		}
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
  const geometry = footprintAndHeight(volume);
  return buildPrismMesh(geometry.points, geometry.height).vertices
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

function prismFootprint(vertices: readonly [number, number, number][]): [number, number][] | undefined {
  const minZ = Math.min(...vertices.map((vertex) => vertex[2]));
  const maxZ = Math.max(...vertices.map((vertex) => vertex[2]));
  if (closeEnough(minZ, maxZ)) return undefined;
  const top = vertices.filter((vertex) => closeEnough(vertex[2], maxZ));
  const bottom = vertices.filter((vertex) => closeEnough(vertex[2], minZ));
  if (top.length < 3 || top.length !== bottom.length || top.length * 2 !== vertices.length) return undefined;
  if (!top.every(([x, y]) => bottom.some(([bottomX, bottomY]) =>
    closeEnough(x, bottomX) && closeEnough(y, bottomY)))) return undefined;
  const centerX = top.reduce((sum, vertex) => sum + vertex[0], 0) / top.length;
  const centerY = top.reduce((sum, vertex) => sum + vertex[1], 0) / top.length;
  return normalizedPolygon(top
    .map(([x, y]) => [x, y] as [number, number])
    .sort((a, b) => Math.atan2(a[1] - centerY, a[0] - centerX) - Math.atan2(b[1] - centerY, b[0] - centerX)));
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

/** Read checked or Valve-authored convex prism tool volumes from VMAP text. */
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
    const footprint = prismFootprint(vertices);
    if (!footprint) continue;
    const mins = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis])));
    const maxs = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis])));
    parsed.push({
      targetname,
      classname: range.entity.classname,
      recipe,
      center,
      size: [maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]],
      footprint,
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
