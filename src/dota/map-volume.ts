import { randomUUID } from "node:crypto";
import { z } from "zod";
import { entityBlockRanges, insertEntity, maxNodeId, parseMapEntities } from "./vmap.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
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

export const managedMapVolumeInputSchema = z.object({
  targetname: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
  recipe: mapVolumeRecipeSchema,
  center: point3,
  size: point3,
  yaw: z.number().finite().optional(),
  properties: z.record(scalar).optional(),
}).strict().superRefine((volume, context) => {
  volume.size.forEach((value, axis) => {
    if (value <= 0 || value > 32768) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["size", axis],
        message: "must be greater than 0 and at most 32768 world units",
      });
    }
  });
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
export interface ManagedMapVolume {
  targetname: string;
  recipe: MapVolumeRecipe;
  center: [number, number, number];
  size: [number, number, number];
  yaw?: number;
  properties?: Record<string, string>;
}

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
    purpose: "Always-solid invisible player collision box.",
  },
};

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
    size: [...volume.size],
    properties: volume.properties
      ? Object.fromEntries(Object.entries(volume.properties).map(([key, property]) => [key, String(property)]))
      : undefined,
  }));
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

const VERTEX_EDGE_INDICES = [14, 23, 18, 22, 10, 6, 16, 7];
const VERTEX_DATA_INDICES = [0, 1, 2, 3, 4, 5, 6, 7];
const EDGE_VERTEX_INDICES = [6, 0, 2, 6, 3, 2, 7, 5, 4, 5, 1, 4, 7, 1, 4, 0, 5, 6, 7, 2, 3, 0, 1, 3];
const EDGE_OPPOSITE_INDICES = Array.from({ length: 24 }, (_, index) => index % 2 === 0 ? index + 1 : index - 1);
const EDGE_NEXT_INDICES = [2, 14, 4, 16, 21, 18, 19, 8, 10, 17, 12, 15, 7, 23, 9, 20, 6, 1, 13, 3, 22, 0, 11, 5];
const EDGE_FACE_INDICES = [0, 3, 0, 4, 0, 2, 4, 1, 1, 3, 1, 5, 1, 2, 3, 5, 4, 3, 2, 4, 5, 0, 5, 2];
const EDGE_DATA_INDICES = Array.from({ length: 24 }, (_, index) => Math.floor(index / 2));
const EDGE_VERTEX_DATA_INDICES = [23, 1, 4, 2, 15, 3, 17, 19, 12, 5, 8, 6, 16, 7, 0, 14, 11, 18, 20, 10, 13, 21, 9, 22];
const FACE_EDGE_INDICES = [21, 7, 23, 17, 19, 15];
const FACE_DATA_INDICES = [0, 1, 2, 3, 4, 5];
const FACE_NORMALS = [
  "1 0 0", "1 0 0", "0 1 0", "-1 0 0", "0 0 1", "1 0 0",
  "0 -1 0", "-1 0 0", "0 0 -1", "0 -1 0", "0 1 0", "0 1 0",
  "0 0 -1", "0 -1 0", "0 -1 0", "0 0 1", "0 0 -1", "0 1 0",
  "1 0 0", "0 0 -1", "-1 0 0", "0 0 1", "-1 0 0", "0 0 1",
];
const FACE_TANGENTS = [
  "0 1 0 -1", "0 1 0 -1", "-1 0 0 -1", "0 -1 0 -1", "1 0 0 -1", "0 1 0 -1",
  "1 0 0 -1", "0 -1 0 -1", "-1 0 0 -1", "1 0 0 -1", "-1 0 0 -1", "-1 0 0 -1",
  "-1 0 0 -1", "1 0 0 -1", "1 0 0 -1", "1 0 0 -1", "-1 0 0 -1", "-1 0 0 -1",
  "0 1 0 -1", "-1 0 0 -1", "0 -1 0 -1", "1 0 0 -1", "0 -1 0 -1", "1 0 0 -1",
];
const FACE_UVS = Array.from({ length: 24 }, () => "0 0");
const FACE_TEXTURE_U = ["1 0 0 32", "-1 0 0 32", "0 -1 0 32", "0 1 0 32", "-1 0 0 32", "1 0 0 32"];
const FACE_TEXTURE_V = ["0 -1 0 32", "0 -1 0 32", "0 0 -1 0", "0 0 -1 0", "0 0 -1 0", "0 0 -1 0"];

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

export function buildBoxVolumeBlock(
  volume: ManagedMapVolume,
  entityNodeId: number,
  meshNodeId = entityNodeId + 1,
): string {
  const parsed = parseManagedMapVolumes([volume])![0];
  const recipe = MAP_VOLUME_RECIPES[parsed.recipe];
  const [hx, hy, hz] = parsed.size.map((value) => value / 2) as [number, number, number];
  const vertices = [
    [hx, -hy, hz], [-hx, -hy, -hz], [-hx, hy, hz], [-hx, -hy, hz],
    [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, -hz],
  ].map(vectorText);
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
  const vertexData = dataArray(8, [dataStream("position", "position", "vector3", vertices, 3)]);
  const faceVertexData = dataArray(24, [
    dataStream("texcoord", "texcoord", "vector2", FACE_UVS, 1),
    dataStream("normal", "normal", "vector3", FACE_NORMALS, 1),
    dataStream("tangent", "tangent", "vector4", FACE_TANGENTS, 1),
  ]);
  const edgeData = dataArray(12, [dataStream("flags", "flags", "int", Array(12).fill(0), 3)]);
  const faceData = dataArray(6, [
    dataStream("textureScale", "textureScale", "vector2", Array(6).fill("1 1"), 0),
    dataStream("textureAxisU", "textureAxisU", "vector4", FACE_TEXTURE_U, 0),
    dataStream("textureAxisV", "textureAxisV", "vector4", FACE_TEXTURE_V, 0),
    dataStream("materialindex", "materialindex", "int", Array(6).fill(0), 8),
    dataStream("flags", "flags", "int", Array(6).fill(0), 3),
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
				"vertexEdgeIndices" "int_array" [ ${arrayValues(VERTEX_EDGE_INDICES, "")} ]
				"vertexDataIndices" "int_array" [ ${arrayValues(VERTEX_DATA_INDICES, "")} ]
				"edgeVertexIndices" "int_array" [ ${arrayValues(EDGE_VERTEX_INDICES, "")} ]
				"edgeOppositeIndices" "int_array" [ ${arrayValues(EDGE_OPPOSITE_INDICES, "")} ]
				"edgeNextIndices" "int_array" [ ${arrayValues(EDGE_NEXT_INDICES, "")} ]
				"edgeFaceIndices" "int_array" [ ${arrayValues(EDGE_FACE_INDICES, "")} ]
				"edgeDataIndices" "int_array" [ ${arrayValues(EDGE_DATA_INDICES, "")} ]
				"edgeVertexDataIndices" "int_array" [ ${arrayValues(EDGE_VERTEX_DATA_INDICES, "")} ]
				"faceEdgeIndices" "int_array" [ ${arrayValues(FACE_EDGE_INDICES, "")} ]
				"faceDataIndices" "int_array" [ ${arrayValues(FACE_DATA_INDICES, "")} ]
				"materials" "string_array" [ "${recipe.material}" ]
				"vertexData" ${vertexData.split("\n").map((line) => `\t\t\t\t${line}`).join("\n").trimStart()}
				"faceVertexData" ${faceVertexData.split("\n").map((line) => `\t\t\t\t${line}`).join("\n").trimStart()}
				"edgeData" ${edgeData.split("\n").map((line) => `\t\t\t\t${line}`).join("\n").trimStart()}
				"faceData" ${faceData.split("\n").map((line) => `\t\t\t\t${line}`).join("\n").trimStart()}
				"subdivisionData" "CDmePolygonMeshSubdivisionData"
				{
					"id" "elementid" "${randomUUID()}"
					"subdivisionLevels" "int_array" [ ${arrayValues(Array(24).fill(0), "")} ]
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
  return vertices.length === 8 ? vertices : undefined;
}

function blockMaterial(block: string): string | undefined {
  return /"materials"\s+"string_array"\s*\[\s*"([^"]+)"/.exec(block)?.[1];
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-4;
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
  const mins = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis])));
  const maxs = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis])));
  if (!desired.size.every((value, axis) => closeEnough(maxs[axis] - mins[axis], value))) return false;
  const properties = { ...recipe.properties, ...(desired.properties ?? {}) };
  return Object.entries(properties).every(([key, value]) => entity.properties[key] === value);
}

export interface MapVolumeReconcileResult {
  text: string;
  added: string[];
  updated: string[];
  unchanged: string[];
}

export interface ParsedMapBoxVolume {
  targetname: string;
  classname: string;
  recipe: MapVolumeRecipe;
  center: [number, number, number];
  size: [number, number, number];
  yaw: number;
  material: string;
  blocking: boolean;
}

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

/** Read checked or Valve-authored rectangular tool volumes from VMAP text. */
export function parseMapBoxVolumes(text: string): ParsedMapBoxVolume[] {
  const parsed: ParsedMapBoxVolume[] = [];
  for (const range of entityBlockRanges(text)) {
    const center = parseVector(range.entity.origin);
    const angles = parseVector(range.entity.angles) ?? [0, 0, 0];
    const vertices = positionVertices(range.block);
    const material = blockMaterial(range.block);
    if (!center || !vertices || !material) continue;
    const targetname = range.entity.targetname ?? `unnamed_volume_${range.start}`;
    const recipe = inferredRecipe(range.entity.classname, material, targetname);
    if (!recipe) continue;
    const mins = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis])));
    const maxs = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis])));
    parsed.push({
      targetname,
      classname: range.entity.classname,
      recipe,
      center,
      size: [maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]],
      yaw: angles[1],
      material,
      blocking: recipe === "playerClip",
    });
  }
  return parsed;
}

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
      additions.push(buildBoxVolumeBlock(volume, nextNodeId, nextNodeId + 1));
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
      block: buildBoxVolumeBlock(volume, nodeIds[0] ?? nextNodeId++, nodeIds[1] ?? nextNodeId++),
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
