import { parseTileGrid } from "./tilegrid.js";
import { ParsedMapEntity, parseMapEntities } from "./vmap.js";

export interface MapInspectOptions {
  classname?: string;
  targetname?: string;
  targetnamePrefix?: string;
  namedOnly?: boolean;
  includeProperties?: boolean;
  includePathNodes?: boolean;
  limit?: number;
}

export interface InspectedMapEntity {
  classname: string;
  targetname?: string;
  origin?: string;
  angles?: string;
  target?: string;
  nodeId?: number;
  properties?: Record<string, string>;
}

export interface InspectedPathNode {
  targetname: string;
  origin?: string;
  target?: string;
}

export interface InspectedPathChain {
  start: string;
  classname: string;
  nodeCount: number;
  end: string;
  loop: boolean;
  brokenTarget?: string;
  nodes?: InspectedPathNode[];
}

export interface TerrainInspection {
  width: number;
  height: number;
  tileSize: number;
  origin: [number, number, number];
  worldBounds: {
    min: [number, number];
    max: [number, number];
  };
  minHeight: number;
  maxHeight: number;
  waterVertexCount: number;
  tilesets: Record<string, number>;
}

export interface MapInspection {
  entityCount: number;
  namedEntityCount: number;
  matchedCount: number;
  returnedCount: number;
  truncated: boolean;
  classCounts: Record<string, number>;
  entities: InspectedMapEntity[];
  paths: InspectedPathChain[];
  terrain?: TerrainInspection;
  findings: {
    code: "broken-path-target" | "entity-out-of-bounds";
    targetname: string;
    detail: string;
  }[];
}

function numericSuffix(name: string): number {
  const suffix = name.match(/(\d+)$/)?.[1];
  return suffix === undefined ? Number.MAX_SAFE_INTEGER : Number(suffix);
}

function pathEntity(entity: ParsedMapEntity): boolean {
  return ["path_corner", "path_track"].includes(entity.classname) && !!entity.targetname;
}

function inspectPathChains(entities: ParsedMapEntity[], includeNodes: boolean): InspectedPathChain[] {
  const paths = entities.filter(pathEntity);
  const byName = new Map(paths.map((entity) => [entity.targetname!, entity]));
  const incoming = new Map<string, number>();
  for (const entity of paths) {
    if (entity.target && byName.has(entity.target)) {
      incoming.set(entity.target, (incoming.get(entity.target) ?? 0) + 1);
    }
  }

  const ordered = [...paths].sort((a, b) => {
    const aIncoming = incoming.get(a.targetname!) ?? 0;
    const bIncoming = incoming.get(b.targetname!) ?? 0;
    if ((aIncoming === 0) !== (bIncoming === 0)) return aIncoming === 0 ? -1 : 1;
    const prefix = a.targetname!.localeCompare(b.targetname!, undefined, { numeric: true });
    return prefix || numericSuffix(a.targetname!) - numericSuffix(b.targetname!);
  });
  const visited = new Set<string>();
  const chains: InspectedPathChain[] = [];

  for (const candidate of ordered) {
    if (visited.has(candidate.targetname!)) continue;
    const nodes: InspectedPathNode[] = [];
    const local = new Set<string>();
    let current: ParsedMapEntity | undefined = candidate;
    let loop = false;
    let brokenTarget: string | undefined;

    while (current?.targetname && !local.has(current.targetname)) {
      visited.add(current.targetname);
      local.add(current.targetname);
      nodes.push({
        targetname: current.targetname,
        origin: current.origin,
        target: current.target,
      });
      if (!current.target) break;
      const next = byName.get(current.target);
      if (!next) {
        brokenTarget = current.target;
        break;
      }
      if (local.has(next.targetname!)) {
        loop = true;
        break;
      }
      current = next;
    }

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    chains.push({
      start: first.targetname,
      classname: candidate.classname,
      nodeCount: nodes.length,
      end: last.targetname,
      loop,
      brokenTarget,
      nodes: includeNodes ? nodes : undefined,
    });
  }
  return chains;
}

function vector3(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const coordinates = value.trim().split(/\s+/).map(Number);
  if (coordinates.length !== 3 || coordinates.some((coordinate) => !Number.isFinite(coordinate))) return undefined;
  return coordinates as [number, number, number];
}

function terrainInspection(text: string): TerrainInspection | undefined {
  try {
    const terrain = parseTileGrid(text);
    const tilesets: Record<string, number> = {};
    for (const tileset of terrain.tileset) {
      const key = String(tileset);
      tilesets[key] = (tilesets[key] ?? 0) + 1;
    }
    return {
      width: terrain.width,
      height: terrain.height,
      tileSize: terrain.tileSize,
      origin: terrain.origin,
      worldBounds: {
        min: [terrain.origin[0], terrain.origin[1]],
        max: [
          terrain.origin[0] + terrain.width * terrain.tileSize,
          terrain.origin[1] + terrain.height * terrain.tileSize,
        ],
      },
      minHeight: terrain.heights.length ? Math.min(...terrain.heights) : 0,
      maxHeight: terrain.heights.length ? Math.max(...terrain.heights) : 0,
      waterVertexCount: terrain.water.filter(Boolean).length,
      tilesets,
    };
  } catch {
    return undefined;
  }
}

export function inspectMapText(text: string, options: MapInspectOptions = {}): MapInspection {
  const all = parseMapEntities(text);
  const classCounts: Record<string, number> = {};
  for (const entity of all) classCounts[entity.classname] = (classCounts[entity.classname] ?? 0) + 1;

  const namedOnly = options.namedOnly !== false;
  const matching = all.filter((entity) => {
    if (namedOnly && !entity.targetname) return false;
    if (options.classname && entity.classname !== options.classname) return false;
    if (options.targetname && entity.targetname !== options.targetname) return false;
    if (options.targetnamePrefix && !entity.targetname?.startsWith(options.targetnamePrefix)) return false;
    return true;
  });
  const limit = Math.max(1, Math.min(1000, options.limit ?? 200));
  const selected = matching.slice(0, limit);
  const terrain = terrainInspection(text);
  const findings: MapInspection["findings"] = [];
  const paths = inspectPathChains(all, options.includePathNodes === true);
  for (const path of paths) {
    if (path.brokenTarget) {
      findings.push({
        code: "broken-path-target",
        targetname: path.end,
        detail: `Targets missing waypoint "${path.brokenTarget}".`,
      });
    }
  }
  if (terrain) {
    const [minX, minY] = terrain.worldBounds.min;
    const [maxX, maxY] = terrain.worldBounds.max;
    for (const entity of all) {
      if (!entity.targetname) continue;
      const origin = vector3(entity.origin);
      if (!origin) continue;
      if (origin[0] < minX || origin[0] > maxX || origin[1] < minY || origin[1] > maxY) {
        findings.push({
          code: "entity-out-of-bounds",
          targetname: entity.targetname,
          detail: `Origin ${entity.origin} is outside x=${minX}..${maxX}, y=${minY}..${maxY}.`,
        });
      }
    }
  }

  return {
    entityCount: all.length,
    namedEntityCount: all.filter((entity) => entity.targetname).length,
    matchedCount: matching.length,
    returnedCount: selected.length,
    truncated: selected.length < matching.length,
    classCounts: Object.fromEntries(
      Object.entries(classCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    entities: selected.map((entity) => ({
      classname: entity.classname,
      targetname: entity.targetname,
      origin: entity.origin,
      angles: entity.angles,
      target: entity.target,
      nodeId: entity.nodeId,
      properties: options.includeProperties ? entity.properties : undefined,
    })),
    paths,
    terrain,
    findings,
  };
}
