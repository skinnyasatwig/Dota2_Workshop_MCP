import { parseTileGrid, TileGrid, vIndex } from "./tilegrid.js";
import { ParsedMapEntity, parseMapEntities } from "./vmap.js";

export interface MapInspectOptions {
  classname?: string;
  targetname?: string;
  targetnamePrefix?: string;
  namedOnly?: boolean;
  includeProperties?: boolean;
  includePathNodes?: boolean;
  checkPathability?: boolean;
  pathSampleSpacing?: number;
  maxTerrainStep?: number;
  maxCellHeightSpan?: number;
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
  terrain?: RouteTerrainInspection;
  nodes?: InspectedPathNode[];
}

export interface RouteTerrainInspection {
  passable: boolean;
  sampleSpacing: number;
  heightStepLimit: number;
  sampleCount: number;
  minHeightLevel?: number;
  maxHeightLevel?: number;
  maxHeightStep: number;
  waterSampleCount: number;
  outOfBoundsSampleCount: number;
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
  maxCellHeightSpan: number;
  abruptCellCount: number;
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
    code:
      | "broken-path-target"
      | "entity-out-of-bounds"
      | "path-out-of-bounds"
      | "path-crosses-water"
      | "path-steep-terrain"
      | "terrain-abrupt-cell";
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

interface TerrainSample {
  height: number;
  water: boolean;
}

function sampleTerrain(terrain: TileGrid, x: number, y: number): TerrainSample | undefined {
  const gridX = (x - terrain.origin[0]) / terrain.tileSize;
  const gridY = (y - terrain.origin[1]) / terrain.tileSize;
  if (gridX < 0 || gridX > terrain.width || gridY < 0 || gridY > terrain.height) return undefined;

  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const x1 = Math.min(terrain.width, x0 + 1);
  const y1 = Math.min(terrain.height, y0 + 1);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const weights = [
    [(1 - tx) * (1 - ty), x0, y0],
    [tx * (1 - ty), x1, y0],
    [(1 - tx) * ty, x0, y1],
    [tx * ty, x1, y1],
  ] as const;
  let height = 0;
  let water = 0;
  for (const [weight, vx, vy] of weights) {
    const index = vIndex(terrain, vx, vy);
    height += (terrain.heights[index] ?? 0) * weight;
    water += (terrain.water[index] ?? 0) * weight;
  }
  return { height, water: water >= 0.5 };
}

function inspectRouteTerrain(
  terrain: TileGrid,
  nodes: InspectedPathNode[],
  sampleSpacing: number,
  heightStepLimit: number,
): RouteTerrainInspection | undefined {
  const points = nodes.map((node) => vector3(node.origin)).filter((point) => point !== undefined);
  if (!points.length) return undefined;

  const samples: [number, number][] = [];
  if (points.length === 1) {
    samples.push([points[0][0], points[0][1]]);
  } else {
    for (let segment = 0; segment < points.length - 1; segment++) {
      const from = points[segment];
      const to = points[segment + 1];
      const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const steps = Math.max(1, Math.ceil(distance / sampleSpacing));
      for (let step = segment === 0 ? 0 : 1; step <= steps; step++) {
        const amount = step / steps;
        samples.push([
          from[0] + (to[0] - from[0]) * amount,
          from[1] + (to[1] - from[1]) * amount,
        ]);
      }
    }
  }

  const heights: number[] = [];
  let waterSampleCount = 0;
  let outOfBoundsSampleCount = 0;
  let maxHeightStep = 0;
  let previousHeight: number | undefined;
  for (const [x, y] of samples) {
    const sample = sampleTerrain(terrain, x, y);
    if (!sample) {
      outOfBoundsSampleCount++;
      previousHeight = undefined;
      continue;
    }
    heights.push(sample.height);
    if (sample.water) waterSampleCount++;
    if (previousHeight !== undefined) {
      maxHeightStep = Math.max(maxHeightStep, Math.abs(sample.height - previousHeight));
    }
    previousHeight = sample.height;
  }

  return {
    passable:
      outOfBoundsSampleCount === 0 &&
      waterSampleCount === 0 &&
      maxHeightStep <= heightStepLimit,
    sampleSpacing,
    heightStepLimit,
    sampleCount: samples.length,
    minHeightLevel: heights.length ? Math.min(...heights) : undefined,
    maxHeightLevel: heights.length ? Math.max(...heights) : undefined,
    maxHeightStep,
    waterSampleCount,
    outOfBoundsSampleCount,
  };
}

function terrainInspection(text: string, maxAllowedCellHeightSpan: number): TerrainInspection | undefined {
  try {
    const terrain = parseTileGrid(text);
    const tilesets: Record<string, number> = {};
    for (const tileset of terrain.tileset) {
      const key = String(tileset);
      tilesets[key] = (tilesets[key] ?? 0) + 1;
    }
    let maxCellHeightSpan = 0;
    let abruptCellCount = 0;
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const corners = [
          terrain.heights[vIndex(terrain, x, y)],
          terrain.heights[vIndex(terrain, x + 1, y)],
          terrain.heights[vIndex(terrain, x, y + 1)],
          terrain.heights[vIndex(terrain, x + 1, y + 1)],
        ];
        const span = Math.max(...corners) - Math.min(...corners);
        maxCellHeightSpan = Math.max(maxCellHeightSpan, span);
        if (span > maxAllowedCellHeightSpan) abruptCellCount++;
      }
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
      maxCellHeightSpan,
      abruptCellCount,
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
  const maxAllowedCellHeightSpan = Math.max(0, options.maxCellHeightSpan ?? 1);
  const terrain = terrainInspection(text, maxAllowedCellHeightSpan);
  let tileGrid: TileGrid | undefined;
  if (terrain && options.checkPathability !== false) {
    try {
      tileGrid = parseTileGrid(text);
    } catch {
      tileGrid = undefined;
    }
  }
  const findings: MapInspection["findings"] = [];
  const paths = inspectPathChains(all, true);
  const sampleSpacing = Math.max(16, Math.min(4096, options.pathSampleSpacing ?? 128));
  const heightStepLimit = Math.max(0, options.maxTerrainStep ?? 1);
  for (const path of paths) {
    if (path.brokenTarget) {
      findings.push({
        code: "broken-path-target",
        targetname: path.end,
        detail: `Targets missing waypoint "${path.brokenTarget}".`,
      });
    }
    if (tileGrid && path.nodes) {
      path.terrain = inspectRouteTerrain(tileGrid, path.nodes, sampleSpacing, heightStepLimit);
      if (path.terrain?.outOfBoundsSampleCount) {
        findings.push({
          code: "path-out-of-bounds",
          targetname: path.start,
          detail: `${path.terrain.outOfBoundsSampleCount}/${path.terrain.sampleCount} route samples are outside the terrain grid.`,
        });
      }
      if (path.terrain?.waterSampleCount) {
        findings.push({
          code: "path-crosses-water",
          targetname: path.start,
          detail: `${path.terrain.waterSampleCount}/${path.terrain.sampleCount} route samples cross water.`,
        });
      }
      if (path.terrain && path.terrain.maxHeightStep > heightStepLimit) {
        findings.push({
          code: "path-steep-terrain",
          targetname: path.start,
          detail:
            `Maximum sampled terrain-height step ${path.terrain.maxHeightStep.toFixed(2)} exceeds ` +
            `the configured limit ${heightStepLimit}.`,
        });
      }
    }
    if (options.includePathNodes !== true) path.nodes = undefined;
  }
  if (terrain) {
    if (terrain.abruptCellCount > 0) {
      findings.push({
        code: "terrain-abrupt-cell",
        targetname: "tile_grid",
        detail:
          `${terrain.abruptCellCount} terrain cell(s) span more than ` +
          `${maxAllowedCellHeightSpan} height level(s); maximum span is ${terrain.maxCellHeightSpan}.`,
      });
    }
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
