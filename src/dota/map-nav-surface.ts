import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildMapMeshNode, numberText } from "./map-mesh.js";
import {
  buildExtrudedSolidMesh,
  ManagedMapSolid,
  parseManagedMapSolids,
  triangulateSimplePolygon,
} from "./map-solid.js";
import { insertEntity, maxNodeId } from "./vmap.js";
import { TileGrid, tileToWorld, vIndex } from "./tilegrid.js";

export const DOTA_NAV_WALKABLE_MATERIAL = "materials/editor/dota_nav_walkable.vmat";
const GROUP_PREFIX = "MCP Nav Surface: ";

const point2 = z.tuple([z.number().finite(), z.number().finite()]);
const point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const extrusion = z.union([
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

export const managedMapNavSurfaceInputSchema = z.object({
  targetname: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/),
  center: point3,
  yaw: z.number().finite().optional(),
  extrusion,
}).strict();

export interface ManagedMapNavSurface {
  targetname: string;
  center: [number, number, number];
  yaw?: number;
  extrusion: ManagedMapSolid["extrusion"];
}

function geometrySolid(surface: ManagedMapNavSurface): ManagedMapSolid {
  return {
    ...surface,
    material: "materials/dev/reflectivity_30.vmat",
  };
}

export function parseManagedMapNavSurfaces(
  value: unknown,
  field = "managedNavSurfaces",
  path = "inline map specification",
): ManagedMapNavSurface[] | undefined {
  if (value === undefined) return undefined;
  const result = z.array(managedMapNavSurfaceInputSchema).safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${field}${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`)
      .join("; ");
    throw new Error(`${details}: ${path}`);
  }
  return result.data.map((surface, index) => {
    try {
      const parsed = parseManagedMapSolids([geometrySolid(surface)])![0];
      return {
        targetname: parsed.targetname,
        center: parsed.center,
        yaw: parsed.yaw,
        extrusion: parsed.extrusion,
      };
    } catch (error) {
      throw new Error(
        `${field}.${index}: ${error instanceof Error ? error.message : String(error)}: ${path}`,
      );
    }
  });
}

function escaped(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function indent(block: string, tabs: number): string {
  const prefix = "\t".repeat(tabs);
  return block.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

export function buildMapNavSurfaceBlock(
  surface: ManagedMapNavSurface,
  groupNodeId: number,
  meshNodeId = groupNodeId + 1,
): string {
  const parsed = parseManagedMapNavSurfaces([surface])![0];
  const mesh = buildExtrudedSolidMesh(geometrySolid(parsed));
  const yaw = numberText(((parsed.yaw ?? 0) % 360 + 360) % 360);
  const origin = parsed.center.map(numberText).join(" ");
  const meshBlock = buildMapMeshNode(mesh, {
    nodeId: meshNodeId,
    origin: parsed.center,
    yaw: parsed.yaw,
    material: DOTA_NAV_WALKABLE_MATERIAL,
    physicsType: "default",
  });
  return `"CMapGroup"
{
\t"id" "elementid" "${randomUUID()}"
\t"name" "string" "${GROUP_PREFIX}${escaped(parsed.targetname)}"
\t"nodeID" "int" "${groupNodeId}"
\t"referenceID" "uint64" "0x0"
\t"origin" "vector3" "${origin}"
\t"angles" "qangle" "0 ${yaw} 0"
\t"scales" "vector3" "1 1 1"
\t"children" "element_array"
\t[
${indent(meshBlock, 2)}
\t]
\t"variableTargetKeys" "string_array" [ ]
\t"variableNames" "string_array" [ ]
\t"transformLocked" "bool" "0"
\t"force_hidden" "bool" "0"
\t"editorOnly" "bool" "0"
\t"customVisGroup" "string" "MCP Navigation"
}`;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let escapedCharacter = false;
  for (let index = open; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escapedCharacter) escapedCharacter = false;
      else if (character === "\\") escapedCharacter = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

interface NavSurfaceRange {
  start: number;
  end: number;
  block: string;
  targetname: string;
}

function navSurfaceRanges(text: string): NavSurfaceRange[] {
  const ranges: NavSurfaceRange[] = [];
  const marker = /"CMapGroup"\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    const open = text.indexOf("{", match.index);
    const close = matchingBrace(text, open);
    if (close < 0) break;
    const block = text.slice(match.index, close + 1);
    const name = /"name"\s+"string"\s+"MCP Nav Surface: ([A-Za-z_][A-Za-z0-9_.-]*)"/.exec(block)?.[1];
    if (name) ranges.push({ start: match.index, end: close + 1, block, targetname: name });
    marker.lastIndex = close + 1;
  }
  return ranges;
}

function vector(value: string | undefined): [number, number, number] | undefined {
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
    .map((entry) => vector(entry[1]))
    .filter((entry): entry is [number, number, number] => !!entry);
  return vertices.length >= 6 && vertices.length % 2 === 0 ? vertices : undefined;
}

function integerArray(block: string, name: string): number[] | undefined {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`"${safeName}"\\s+"int_array"\\s*\\[([\\s\\S]*?)\\]`).exec(block);
  if (!match) return undefined;
  return [...match[1].matchAll(/"(-?\d+)"/g)].map((entry) => Number(entry[1]));
}

function sameNumbers(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  return !!actual && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function navSurfaceBlockMatches(block: string, surface: ManagedMapNavSurface): boolean {
  const center = vector(block.match(/"origin"\s+"vector3"\s+"([^"]+)"/)?.[1]);
  const angles = vector(block.match(/"angles"\s+"qangle"\s+"([^"]+)"/)?.[1]);
  const desired = parseManagedMapNavSurfaces([surface])![0];
  if (!center || !center.every((value, axis) => Math.abs(value - desired.center[axis]) <= 1e-4)) return false;
  const yaw = ((desired.yaw ?? 0) % 360 + 360) % 360;
  if (!angles || Math.abs(angles[0]) > 1e-4 || Math.abs(angles[1] - yaw) > 1e-4 || Math.abs(angles[2]) > 1e-4) {
    return false;
  }
  if (!block.includes(`"${DOTA_NAV_WALKABLE_MATERIAL}"`)) return false;
  if (!/"physicsType"\s+"string"\s+"default"/.test(block)) return false;
  const mesh = buildExtrudedSolidMesh(geometrySolid(desired));
  const vertices = positionVertices(block);
  if (
    !vertices || vertices.length !== mesh.vertices.length ||
    !vertices.every((vertex, index) => {
      const expected = vector(mesh.vertices[index]);
      return !!expected && vertex.every((value, axis) => Math.abs(value - expected[axis]) <= 1e-4);
    })
  ) return false;
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
  return true;
}

export interface ParsedMapNavSurface {
  targetname: string;
  center: [number, number, number];
  yaw: number;
  footprint: [number, number][];
  height?: number;
  sloped?: { bottom: number[]; top: number[] };
  material: typeof DOTA_NAV_WALKABLE_MATERIAL;
}

export interface MapNavSurfaceClearance {
  targetname: string;
  /** Terrain cells whose square overlaps the rotated deck footprint. */
  overlappingCellCount: number;
  fullyInsideGrid: boolean;
  deckBottomWorldZ: [number, number];
  deckTopWorldZ: [number, number];
  terrainWorldZ: [number, number] | null;
  /** Conservative: lowest deck bottom minus highest overlapping terrain. */
  minimumUnderpassClearance: number | null;
  agentHeight: number;
  underpassClearAtAgentHeight: boolean | null;
  /** This offline report does not pretend a single-layer tile graph can prove elevated deck routes. */
  deckConnectivity: "engine-navigation-required";
}

function pointInPolygon(point: [number, number], polygon: readonly [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index];
    const [px, py] = polygon[previous];
    if ((y > point[1]) !== (py > point[1]) &&
      point[0] < ((px - x) * (point[1] - y)) / (py - y || Number.EPSILON) + x) inside = !inside;
  }
  return inside;
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: [number, number], b: [number, number], point: [number, number]): boolean {
  return Math.abs(orientation(a, b, point)) <= 1e-7 &&
    point[0] >= Math.min(a[0], b[0]) - 1e-7 && point[0] <= Math.max(a[0], b[0]) + 1e-7 &&
    point[1] >= Math.min(a[1], b[1]) - 1e-7 && point[1] <= Math.max(a[1], b[1]) + 1e-7;
}

function segmentsIntersect(
  firstA: [number, number],
  firstB: [number, number],
  secondA: [number, number],
  secondB: [number, number],
): boolean {
  const firstSecondA = orientation(firstA, firstB, secondA);
  const firstSecondB = orientation(firstA, firstB, secondB);
  const secondFirstA = orientation(secondA, secondB, firstA);
  const secondFirstB = orientation(secondA, secondB, firstB);
  if (((firstSecondA > 1e-7 && firstSecondB < -1e-7) || (firstSecondA < -1e-7 && firstSecondB > 1e-7)) &&
    ((secondFirstA > 1e-7 && secondFirstB < -1e-7) || (secondFirstA < -1e-7 && secondFirstB > 1e-7))) return true;
  return onSegment(firstA, firstB, secondA) || onSegment(firstA, firstB, secondB) ||
    onSegment(secondA, secondB, firstA) || onSegment(secondA, secondB, firstB);
}

function polygonOverlapsCell(
  polygon: readonly [number, number][],
  minimum: [number, number],
  maximum: [number, number],
): boolean {
  const corners: [number, number][] = [
    minimum,
    [maximum[0], minimum[1]],
    maximum,
    [minimum[0], maximum[1]],
  ];
  if (polygon.some(([x, y]) => x >= minimum[0] && x <= maximum[0] && y >= minimum[1] && y <= maximum[1])) {
    return true;
  }
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex++) {
    const polygonA = polygon[polygonIndex];
    const polygonB = polygon[(polygonIndex + 1) % polygon.length];
    for (let cellIndex = 0; cellIndex < corners.length; cellIndex++) {
      if (segmentsIntersect(polygonA, polygonB, corners[cellIndex], corners[(cellIndex + 1) % corners.length])) {
        return true;
      }
    }
  }
  return false;
}

function worldFootprint(surface: ParsedMapNavSurface): [number, number][] {
  const radians = (surface.yaw * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return surface.footprint.map(([x, y]) => [
    surface.center[0] + x * cosine - y * sine,
    surface.center[1] + x * sine + y * cosine,
  ]);
}

/**
 * Conservatively inspect whether terrain physically fits beneath a checked navigation deck.
 * Elevated route connectivity remains a Valve GridNav fact because the tile-grid graph is single-layer.
 */
export function analyzeMapNavSurfaceClearance(
  grid: TileGrid,
  surfaces: readonly ParsedMapNavSurface[],
  agentHeight = 256,
): MapNavSurfaceClearance[] {
  const checkedAgentHeight = Math.max(1, agentHeight);
  const gridMinimum: [number, number] = [grid.origin[0], grid.origin[1]];
  const gridMaximum: [number, number] = [
    grid.origin[0] + grid.width * grid.tileSize,
    grid.origin[1] + grid.height * grid.tileSize,
  ];
  return surfaces.map((surface) => {
    // Validate the outline and keep its deterministic topology coupled to the checked mesh writer.
    triangulateSimplePolygon(surface.footprint);
    const footprint = worldFootprint(surface);
    const bottom = surface.sloped?.bottom ?? surface.footprint.map(() => -(surface.height ?? 0) / 2);
    const top = surface.sloped?.top ?? surface.footprint.map(() => (surface.height ?? 0) / 2);
    const deckBottomWorldZ: [number, number] = [
      surface.center[2] + Math.min(...bottom),
      surface.center[2] + Math.max(...bottom),
    ];
    const deckTopWorldZ: [number, number] = [
      surface.center[2] + Math.min(...top),
      surface.center[2] + Math.max(...top),
    ];
    const terrainSamples: number[] = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const minimum = tileToWorld(grid, x, y);
        const maximum = tileToWorld(grid, x + 1, y + 1);
        if (!polygonOverlapsCell(footprint, minimum, maximum)) continue;
        for (const index of [
          vIndex(grid, x, y),
          vIndex(grid, x + 1, y),
          vIndex(grid, x, y + 1),
          vIndex(grid, x + 1, y + 1),
        ]) {
          terrainSamples.push(grid.origin[2] + 128 + (grid.heights[index] ?? 0) * 256);
        }
      }
    }
    const terrainWorldZ: [number, number] | null = terrainSamples.length
      ? [Math.min(...terrainSamples), Math.max(...terrainSamples)]
      : null;
    const minimumUnderpassClearance = terrainWorldZ
      ? deckBottomWorldZ[0] - terrainWorldZ[1]
      : null;
    return {
      targetname: surface.targetname,
      overlappingCellCount: terrainSamples.length / 4,
      fullyInsideGrid: footprint.every(([x, y]) =>
        x >= gridMinimum[0] && x <= gridMaximum[0] && y >= gridMinimum[1] && y <= gridMaximum[1]),
      deckBottomWorldZ,
      deckTopWorldZ,
      terrainWorldZ,
      minimumUnderpassClearance,
      agentHeight: checkedAgentHeight,
      underpassClearAtAgentHeight: minimumUnderpassClearance === null
        ? null
        : minimumUnderpassClearance >= checkedAgentHeight,
      deckConnectivity: "engine-navigation-required",
    };
  });
}

export function parseMapNavSurfaces(text: string): ParsedMapNavSurface[] {
  const parsed: ParsedMapNavSurface[] = [];
  for (const range of navSurfaceRanges(text)) {
    const center = vector(range.block.match(/"origin"\s+"vector3"\s+"([^"]+)"/)?.[1]);
    const angles = vector(range.block.match(/"angles"\s+"qangle"\s+"([^"]+)"/)?.[1]) ?? [0, 0, 0];
    const vertices = positionVertices(range.block);
    if (!center || !vertices || !range.block.includes(`"${DOTA_NAV_WALKABLE_MATERIAL}"`)) continue;
    const count = vertices.length / 2;
    const top = vertices.slice(0, count);
    const bottom = vertices.slice(count);
    if (!top.every((vertex, index) =>
      Math.abs(vertex[0] - bottom[index][0]) <= 1e-4 &&
      Math.abs(vertex[1] - bottom[index][1]) <= 1e-4)) continue;
    const topHeights = top.map((vertex) => vertex[2]);
    const bottomHeights = bottom.map((vertex) => vertex[2]);
    const flat = topHeights.every((height) => Math.abs(height - topHeights[0]) <= 1e-4) &&
      bottomHeights.every((height) => Math.abs(height - bottomHeights[0]) <= 1e-4) &&
      Math.abs(topHeights[0] + bottomHeights[0]) <= 1e-4;
    parsed.push({
      targetname: range.targetname,
      center,
      yaw: angles[1],
      footprint: top.map(([x, y]) => [x, y]),
      ...(flat
        ? { height: topHeights[0] - bottomHeights[0] }
        : { sloped: { bottom: bottomHeights, top: topHeights } }),
      material: DOTA_NAV_WALKABLE_MATERIAL,
    });
  }
  return parsed;
}

export interface MapNavSurfaceReconcileResult {
  text: string;
  added: string[];
  updated: string[];
  unchanged: string[];
}

export function reconcileMapNavSurfaces(
  text: string,
  surfaces: readonly ManagedMapNavSurface[],
): MapNavSurfaceReconcileResult {
  const parsed = parseManagedMapNavSurfaces(surfaces) ?? [];
  const ranges = navSurfaceRanges(text);
  const byName = new Map<string, NavSurfaceRange[]>();
  for (const range of ranges) byName.set(range.targetname, [...(byName.get(range.targetname) ?? []), range]);
  let nextNodeId = maxNodeId(text) + 1;
  const replacements: { start: number; end: number; block: string }[] = [];
  const additions: string[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  for (const surface of parsed) {
    const matches = byName.get(surface.targetname) ?? [];
    if (matches.length > 1) throw new Error(`Managed navigation surface is ambiguous in the map: ${surface.targetname}`);
    if (!matches.length) {
      additions.push(buildMapNavSurfaceBlock(surface, nextNodeId, nextNodeId + 1));
      nextNodeId += 2;
      added.push(surface.targetname);
      continue;
    }
    const existing = matches[0];
    if (navSurfaceBlockMatches(existing.block, surface)) {
      unchanged.push(surface.targetname);
      continue;
    }
    const nodeIds = [...existing.block.matchAll(/"nodeID"\s+"int"\s+"(\d+)"/g)]
      .map((match) => Number(match[1]));
    replacements.push({
      start: existing.start,
      end: existing.end,
      block: buildMapNavSurfaceBlock(surface, nodeIds[0] ?? nextNodeId++, nodeIds[1] ?? nextNodeId++),
    });
    updated.push(surface.targetname);
  }
  let out = text;
  for (const replacement of replacements.sort((first, second) => second.start - first.start)) {
    out = out.slice(0, replacement.start) + replacement.block + out.slice(replacement.end);
  }
  for (const block of additions) out = insertEntity(out, block);
  return { text: out, added, updated, unchanged };
}
