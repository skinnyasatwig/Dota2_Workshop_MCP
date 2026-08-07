import { cIndex, parseTileGrid, TileGrid, tileToWorld, vIndex } from "./tilegrid.js";
import { parseMapEntities, ParsedMapEntity } from "./vmap.js";
import { parseMapVolumes, ParsedMapVolume } from "./map-volume.js";
import { parseMapSolids, ParsedMapSolid } from "./map-solid.js";
import {
  collectMapCollisionObstacles,
  distanceToSegment2d,
  MapCollisionObstacle,
  physicalObstacleContainsPoint,
  segmentIntersectsPhysicalObstacle,
} from "./map-collision.js";

export type ReachabilityEntityKind = "spawn" | "objective" | "entrance" | "camp" | "other";

export interface ReachabilityCell {
  x: number;
  y: number;
  height: number;
  minHeight: number;
  maxHeight: number;
  water: boolean;
  ramp: boolean;
  cliff: boolean;
  hole: boolean;
  walkable: boolean;
  blockingVolume?: string;
  collisionObstacle?: string;
  component?: number;
}

export interface ReachabilityRegion {
  id: number;
  cellCount: number;
  tileBounds: { min: [number, number]; max: [number, number] };
  worldBounds: { min: [number, number]; max: [number, number] };
  containsSpawn: boolean;
  reachableFromSpawn: boolean;
}

export interface ReachabilityEntity {
  targetname: string;
  classname: string;
  kind: ReachabilityEntityKind;
  origin?: [number, number, number];
  cell?: [number, number];
  component?: number;
  walkable: boolean;
  reachableFromSpawn: boolean;
}

export interface ReachabilityFinding {
  severity: "error" | "warn";
  code:
    | "terrain-hole"
    | "trapped-spawn"
    | "blocked-entrance"
    | "inaccessible-objective"
    | "inaccessible-camp"
    | "isolated-region"
    | "entity-out-of-bounds"
    | "blocked-path-node"
    | "blocked-path-segment"
    | "path-collision-obstacle";
  targetname: string;
  detail: string;
  cells?: [number, number][];
}

export interface MapReachabilityOptions {
  maxFlatStep?: number;
  maxRampStep?: number;
  minRegionCells?: number;
  /** Conservative offline standing clearance above terrain (default 256 world units). */
  agentHeight?: number;
  blockingVolumes?: readonly BlockingMapShape[];
  collisionObstacles?: readonly MapCollisionObstacle[];
}

export type BlockingMapShape = Pick<
  ParsedMapVolume | ParsedMapSolid,
  "targetname" | "center" | "yaw" | "footprint" | "blocking"
> & Partial<Pick<ParsedMapVolume, "size" | "sloped">> & Partial<Pick<ParsedMapSolid, "height">>;

export interface MapReachabilityReport {
  width: number;
  height: number;
  tileSize: number;
  origin: [number, number, number];
  agentHeight: number;
  walkableCellCount: number;
  blockedCellCount: number;
  volumeBlockedCellCount: number;
  collisionObstacleCount: number;
  physicalBoundsCollisionObstacleCount: number;
  exactHullProjectionCount: number;
  meshVertexHullProjectionCount: number;
  curvedPrimitiveProjectionCount: number;
  boundsProjectionCount: number;
  approximatedCollisionObstacleCount: number;
  unknownBoundsCollisionObstacleCount: number;
  modelCollisionBlockedCellCount: number;
  cliffCellCount: number;
  rampCellCount: number;
  waterCellCount: number;
  holeCellCount: number;
  reachableCellCount: number;
  unreachableCellCount: number;
  primaryComponent?: number;
  spawnComponents: number[];
  regions: ReachabilityRegion[];
  entities: ReachabilityEntity[];
  collisionObstacles: MapCollisionObstacle[];
  findings: ReachabilityFinding[];
  cells: ReachabilityCell[];
}

const PATH_CLASSES = new Set(["path_corner", "path_track"]);

function vector3(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts as [number, number, number];
}

export function classifyReachabilityEntity(entity: ParsedMapEntity): ReachabilityEntityKind {
  const name = entity.targetname?.toLowerCase() ?? "";
  const classname = entity.classname.toLowerCase();
  if (/(?:^|_)fow(?:_|$)/.test(name)) return "other";
  if (classname === "npc_dota_neutral_spawner" || /(?:^|_)camp(?:_|$)/.test(name)) return "camp";
  if (
    classname === "npc_dota_tower" ||
    classname === "npc_dota_fort" ||
    /(?:^|_)(?:ancient|fort|boss|roshan|rosh|dragon|objective|t[1-4])(?:_|$)/.test(name)
  ) return "objective";
  if (/(?:^|_)(?:gate|entrance|entry|exit)(?:_|$)/.test(name)) return "entrance";
  if (
    classname.startsWith("info_player_start") ||
    classname === "ent_dota_fountain" ||
    /player_start/.test(name) ||
    /(?:^|_)(?:player_)?spawn(?:_|$)/.test(name) ||
    /courier_spawn/.test(name)
  ) return "spawn";
  return "other";
}

function cellPathEdgeCount(grid: TileGrid, x: number, y: number): number {
  const horizontalCount = grid.width * (grid.height + 1);
  const horizontal = (edgeX: number, edgeY: number) => edgeY * grid.width + edgeX;
  const vertical = (edgeX: number, edgeY: number) => horizontalCount + edgeY * (grid.width + 1) + edgeX;
  return [
    horizontal(x, y),
    horizontal(x, y + 1),
    vertical(x, y),
    vertical(x + 1, y),
  ].reduce((count, index) => count + (grid.pathEdges[index] ? 1 : 0), 0);
}

function pointInPolygon(point: [number, number], polygon: readonly [number, number][]): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (
      Math.abs(cross) <= 1e-6 &&
      point[0] >= Math.min(a[0], b[0]) - 1e-6 && point[0] <= Math.max(a[0], b[0]) + 1e-6 &&
      point[1] >= Math.min(a[1], b[1]) - 1e-6 && point[1] <= Math.max(a[1], b[1]) + 1e-6
    ) return true;
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]);
    if (crosses && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function volumeContainsWorldPoint(volume: BlockingMapShape, x: number, y: number): boolean {
  const radians = (-volume.yaw * Math.PI) / 180;
  const dx = x - volume.center[0];
  const dy = y - volume.center[1];
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  return pointInPolygon([localX, localY], volume.footprint);
}

function blockingVerticalRange(volume: BlockingMapShape): [number, number] | undefined {
  if (volume.sloped) {
    return [
      volume.center[2] + Math.min(...volume.sloped.bottom),
      volume.center[2] + Math.max(...volume.sloped.top),
    ];
  }
  if (volume.height !== undefined) {
    return [volume.center[2] - volume.height / 2, volume.center[2] + volume.height / 2];
  }
  if (volume.size !== undefined) {
    return [volume.center[2] - volume.size[2] / 2, volume.center[2] + volume.size[2] / 2];
  }
  return undefined;
}

function volumeBlocksStandingPoint(
  volume: BlockingMapShape,
  x: number,
  y: number,
  groundZ: number,
  agentHeight: number,
): boolean {
  if (!volume.blocking || !volumeContainsWorldPoint(volume, x, y)) return false;
  const range = blockingVerticalRange(volume);
  if (!range) return true;
  const [bottom, top] = range;
  return top > groundZ + 1e-4 && bottom < groundZ + agentHeight - 1e-4;
}

function buildCells(
  grid: TileGrid,
  blockingVolumes: readonly BlockingMapShape[] = [],
  collisionObstacles: readonly MapCollisionObstacle[] = [],
  agentHeight = 256,
): ReachabilityCell[] {
  const cells: ReachabilityCell[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const corners = [
        vIndex(grid, x, y),
        vIndex(grid, x + 1, y),
        vIndex(grid, x, y + 1),
        vIndex(grid, x + 1, y + 1),
      ];
      const heights = corners.map((index) => grid.heights[index] ?? 0);
      const minHeight = Math.min(...heights);
      const maxHeight = Math.max(...heights);
      const height = heights.reduce((sum, value) => sum + value, 0) / heights.length;
      const configuration = grid.configurations[cIndex(grid, x, y)] ?? [];
      const hole = configuration.length === 0 || !configuration.some((value) => value > 0);
      const pathEdges = cellPathEdgeCount(grid, x, y);
      const ramp = !hole && maxHeight > minHeight && maxHeight - minHeight <= 1 && pathEdges >= 3 && configuration.length <= 2;
      const cliff = !hole && maxHeight > minHeight && !ramp;
      const water = corners.filter((index) => grid.water[index]).length >= 2;
      const [worldX, worldY] = tileToWorld(grid, x + 0.5, y + 0.5);
      // Dota level-zero terrain is centered at z=128 and cliff levels are 256 units apart.
      const worldZ = grid.origin[2] + 128 + height * 256;
      const blockingVolume = blockingVolumes.find((volume) =>
        volumeBlocksStandingPoint(volume, worldX, worldY, worldZ, agentHeight));
      // Apply the terrain height only to bounds recovered from an actual model PHYS block.
      const collisionObstacle = collisionObstacles.find((obstacle) =>
        obstacle.confidence === "physical-model-bounds" &&
        physicalObstacleContainsPoint(obstacle, [worldX, worldY], worldZ));
      cells.push({
        x,
        y,
        height,
        minHeight,
        maxHeight,
        water,
        ramp,
        cliff,
        hole,
        walkable: !hole && !cliff && !blockingVolume && !collisionObstacle,
        blockingVolume: blockingVolume?.targetname,
        collisionObstacle: collisionObstacle?.id,
      });
    }
  }
  return cells;
}

function neighbors(grid: TileGrid, index: number): number[] {
  const x = index % grid.width;
  const y = Math.floor(index / grid.width);
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x + 1 < grid.width) result.push(index + 1);
  if (y > 0) result.push(index - grid.width);
  if (y + 1 < grid.height) result.push(index + grid.width);
  return result;
}

function connected(a: ReachabilityCell, b: ReachabilityCell, maxFlatStep: number, maxRampStep: number): boolean {
  if (!a.walkable || !b.walkable) return false;
  const difference = Math.abs(a.height - b.height);
  return difference <= (a.ramp || b.ramp ? maxRampStep : maxFlatStep);
}

function worldCell(grid: TileGrid, origin: [number, number, number]): [number, number] | undefined {
  const gridX = (origin[0] - grid.origin[0]) / grid.tileSize;
  const gridY = (origin[1] - grid.origin[1]) / grid.tileSize;
  if (gridX < 0 || gridY < 0 || gridX > grid.width || gridY > grid.height) return undefined;
  return [
    Math.min(grid.width - 1, Math.floor(gridX)),
    Math.min(grid.height - 1, Math.floor(gridY)),
  ];
}

function groupedCells(grid: TileGrid, selected: Set<number>): [number, number][][] {
  const groups: [number, number][][] = [];
  const pending = new Set(selected);
  while (pending.size) {
    const start = pending.values().next().value as number;
    pending.delete(start);
    const queue = [start];
    const group: [number, number][] = [];
    while (queue.length) {
      const index = queue.shift()!;
      group.push([index % grid.width, Math.floor(index / grid.width)]);
      for (const next of neighbors(grid, index)) {
        if (!pending.has(next)) continue;
        pending.delete(next);
        queue.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}

export function analyzeTileGridReachability(
  grid: TileGrid,
  sourceEntities: ParsedMapEntity[],
  options: MapReachabilityOptions = {},
): MapReachabilityReport {
  const maxFlatStep = Math.max(0, options.maxFlatStep ?? 0.25);
  const maxRampStep = Math.max(maxFlatStep, options.maxRampStep ?? 0.75);
  const minRegionCells = Math.max(1, Math.floor(options.minRegionCells ?? 4));
  const agentHeight = Math.max(1, options.agentHeight ?? 256);
  const collisionObstacles = [
    ...(options.collisionObstacles ?? collectMapCollisionObstacles(sourceEntities)),
  ];
  const cells = buildCells(grid, options.blockingVolumes, collisionObstacles, agentHeight);
  const componentCells: number[][] = [];

  for (let index = 0; index < cells.length; index++) {
    if (!cells[index].walkable || cells[index].component !== undefined) continue;
    const component = componentCells.length;
    const queue = [index];
    cells[index].component = component;
    const members: number[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      members.push(current);
      for (const next of neighbors(grid, current)) {
        if (cells[next].component !== undefined || !connected(cells[current], cells[next], maxFlatStep, maxRampStep)) continue;
        cells[next].component = component;
        queue.push(next);
      }
    }
    componentCells.push(members);
  }

  const entities: ReachabilityEntity[] = sourceEntities
    .filter((entity) => entity.targetname && !PATH_CLASSES.has(entity.classname))
    .map((entity) => {
      const origin = vector3(entity.origin);
      const cell = origin ? worldCell(grid, origin) : undefined;
      const terrainCell = cell ? cells[cIndex(grid, cell[0], cell[1])] : undefined;
      return {
        targetname: entity.targetname!,
        classname: entity.classname,
        kind: classifyReachabilityEntity(entity),
        origin,
        cell,
        component: terrainCell?.component,
        walkable: terrainCell?.walkable === true,
        reachableFromSpawn: false,
      };
    });

  const spawnComponents = new Set(
    entities
      .filter((entity) => entity.kind === "spawn" && entity.component !== undefined)
      .map((entity) => entity.component!),
  );
  const primaryComponent = spawnComponents.size
    ? [...spawnComponents].sort((a, b) => componentCells[b].length - componentCells[a].length)[0]
    : componentCells
        .map((members, id) => ({ id, size: members.length }))
        .sort((a, b) => b.size - a.size)[0]?.id;
  const reachableComponents = spawnComponents.size
    ? spawnComponents
    : new Set(primaryComponent === undefined ? [] : [primaryComponent]);
  for (const entity of entities) {
    entity.reachableFromSpawn = entity.component !== undefined && reachableComponents.has(entity.component);
  }

  const regions: ReachabilityRegion[] = componentCells.map((members, id) => {
    const xs = members.map((index) => index % grid.width);
    const ys = members.map((index) => Math.floor(index / grid.width));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      id,
      cellCount: members.length,
      tileBounds: { min: [minX, minY], max: [maxX, maxY] },
      worldBounds: {
        min: tileToWorld(grid, minX, minY),
        max: tileToWorld(grid, maxX + 1, maxY + 1),
      },
      containsSpawn: spawnComponents.has(id),
      reachableFromSpawn: reachableComponents.has(id),
    };
  });

  const findings: ReachabilityFinding[] = [];
  const holes = new Set(cells.flatMap((cell, index) => cell.hole ? [index] : []));
  for (const [index, group] of groupedCells(grid, holes).entries()) {
    findings.push({
      severity: "error",
      code: "terrain-hole",
      targetname: `terrain_hole_${index + 1}`,
      detail: `${group.length} tile cell(s) have no usable terrain recipe.`,
      cells: group,
    });
  }
  for (const region of regions) {
    if (region.reachableFromSpawn) continue;
    findings.push({
      severity: "warn",
      code: "isolated-region",
      targetname: `terrain_region_${region.id}`,
      detail:
        `${region.cellCount} walkable cell(s) form an isolated region` +
        `${region.cellCount < minRegionCells ? " (small enough to be a likely trapped shelf)" : ""}.`,
    });
  }
  for (const entity of entities) {
    if (!entity.origin || entity.kind === "other") continue;
    if (!entity.cell) {
      findings.push({
        severity: "error",
        code: "entity-out-of-bounds",
        targetname: entity.targetname,
        detail: `Origin ${entity.origin.join(" ")} is outside the terrain grid.`,
      });
      continue;
    }
    const regionSize = entity.component === undefined ? 0 : componentCells[entity.component].length;
    if (entity.kind === "spawn" && (!entity.walkable || regionSize < minRegionCells)) {
      findings.push({
        severity: "error",
        code: "trapped-spawn",
        targetname: entity.targetname,
        detail: entity.walkable
          ? `Spawn is confined to a ${regionSize}-cell isolated region.`
          : `Spawn sits on a blocked cliff or missing terrain cell.`,
      });
    } else if (entity.kind === "entrance" && (!entity.walkable || regionSize < minRegionCells)) {
      findings.push({
        severity: "error",
        code: "blocked-entrance",
        targetname: entity.targetname,
        detail: entity.walkable
          ? `Entrance connects only to a ${regionSize}-cell isolated region.`
          : `Entrance sits on a blocked cliff or missing terrain cell.`,
      });
    } else if (entity.kind === "objective" && (!entity.walkable || !entity.reachableFromSpawn)) {
      findings.push({
        severity: "error",
        code: "inaccessible-objective",
        targetname: entity.targetname,
        detail: entity.walkable
          ? `Objective is not terrain-connected to any spawn region.`
          : `Objective sits on a blocked cliff or missing terrain cell.`,
      });
    } else if (entity.kind === "camp" && (!entity.walkable || !entity.reachableFromSpawn)) {
      findings.push({
        severity: "warn",
        code: "inaccessible-camp",
        targetname: entity.targetname,
        detail: entity.walkable
          ? `Camp is not terrain-connected to any spawn region.`
          : `Camp sits on a blocked cliff or missing terrain cell.`,
      });
    }
  }

  const paths = sourceEntities.filter(
    (entity) => PATH_CLASSES.has(entity.classname) && entity.targetname,
  );
  const pathByName = new Map(paths.map((entity) => [entity.targetname!, entity]));
  for (const path of paths) {
    const from = vector3(path.origin);
    if (!from) continue;
    const fromCell = worldCell(grid, from);
    if (!fromCell || !cells[cIndex(grid, fromCell[0], fromCell[1])].walkable) {
      findings.push({
        severity: "error",
        code: "blocked-path-node",
        targetname: path.targetname!,
        detail: `Waypoint sits on a blocked cliff, missing terrain cell, or outside the terrain grid.`,
      });
    }
    if (!path.target) continue;
    const target = pathByName.get(path.target);
    const to = vector3(target?.origin);
    if (!to) continue;
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(distance / (grid.tileSize / 2)));
    const blocked = new Set<number>();
    for (let step = 0; step <= steps; step++) {
      const amount = step / steps;
      const point: [number, number, number] = [
        from[0] + (to[0] - from[0]) * amount,
        from[1] + (to[1] - from[1]) * amount,
        from[2] + (to[2] - from[2]) * amount,
      ];
      const cell = worldCell(grid, point);
      if (!cell) {
        blocked.add(-1);
        continue;
      }
      const index = cIndex(grid, cell[0], cell[1]);
      if (!cells[index].walkable) blocked.add(index);
    }
    if (blocked.size) {
      findings.push({
        severity: "error",
        code: "blocked-path-segment",
        targetname: path.targetname!,
        detail:
          `Segment to "${path.target}" crosses ${blocked.size} blocked or out-of-bounds tile cell(s).`,
        cells: [...blocked]
          .filter((index) => index >= 0)
          .map((index) => [index % grid.width, Math.floor(index / grid.width)] as [number, number]),
      });
    }
    const nearbyObstacles = collisionObstacles.filter((obstacle) => {
      if (obstacle.confidence === "physical-model-bounds") {
        return segmentIntersectsPhysicalObstacle(obstacle, from, to);
      }
      return obstacle.approximateRadius !== undefined &&
        Math.abs(obstacle.origin[2] - ((from[2] + to[2]) / 2)) <= grid.tileSize &&
        distanceToSegment2d(
          [obstacle.origin[0], obstacle.origin[1]],
          [from[0], from[1]],
          [to[0], to[1]],
        ) <= obstacle.approximateRadius;
    });
    if (nearbyObstacles.length) {
      const names = nearbyObstacles.slice(0, 5).map((obstacle) => obstacle.id).join(", ");
      findings.push({
        severity: "warn",
        code: "path-collision-obstacle",
        targetname: path.targetname!,
        detail:
          `Segment to "${path.target}" intersects a physical or warning-only collision broad phase for ` +
          `${nearbyObstacles.length} obstruction(s): ${names}` +
          `${nearbyObstacles.length > 5 ? ", …" : ""}. Exact collision still requires GridNav.`,
      });
    }
  }

  const walkableCellCount = cells.filter((cell) => cell.walkable).length;
  const reachableCellCount = cells.filter(
    (cell) => cell.component !== undefined && reachableComponents.has(cell.component),
  ).length;
  return {
    width: grid.width,
    height: grid.height,
    tileSize: grid.tileSize,
    origin: grid.origin,
    agentHeight,
    walkableCellCount,
    blockedCellCount: cells.length - walkableCellCount,
    volumeBlockedCellCount: cells.filter((cell) => cell.blockingVolume !== undefined).length,
    collisionObstacleCount: collisionObstacles.length,
    physicalBoundsCollisionObstacleCount: collisionObstacles.filter(
      (obstacle) => obstacle.confidence === "physical-model-bounds",
    ).length,
    exactHullProjectionCount: collisionObstacles.reduce(
      (count, obstacle) => count +
        (obstacle.physicalFootprints?.filter((footprint) => footprint.projection === "exact-hull").length ?? 0),
      0,
    ),
    meshVertexHullProjectionCount: collisionObstacles.reduce(
      (count, obstacle) => count +
        (obstacle.physicalFootprints?.filter((footprint) => footprint.projection === "mesh-vertex-hull").length ?? 0),
      0,
    ),
    curvedPrimitiveProjectionCount: collisionObstacles.reduce(
      (count, obstacle) => count +
        (obstacle.physicalFootprints?.filter((footprint) => footprint.projection === "curved-primitive").length ?? 0),
      0,
    ),
    boundsProjectionCount: collisionObstacles.reduce(
      (count, obstacle) => count +
        (obstacle.physicalFootprints?.filter((footprint) => footprint.projection === "bounds").length ?? 0),
      0,
    ),
    approximatedCollisionObstacleCount: collisionObstacles.filter(
      (obstacle) => obstacle.confidence === "class-approximation",
    ).length,
    unknownBoundsCollisionObstacleCount: collisionObstacles.filter(
      (obstacle) => obstacle.confidence === "unknown-model-bounds",
    ).length,
    modelCollisionBlockedCellCount: cells.filter(
      (cell) => cell.collisionObstacle !== undefined,
    ).length,
    cliffCellCount: cells.filter((cell) => cell.cliff).length,
    rampCellCount: cells.filter((cell) => cell.ramp).length,
    waterCellCount: cells.filter((cell) => cell.water).length,
    holeCellCount: holes.size,
    reachableCellCount,
    unreachableCellCount: walkableCellCount - reachableCellCount,
    primaryComponent,
    spawnComponents: [...spawnComponents].sort((a, b) => a - b),
    regions,
    entities,
    collisionObstacles,
    findings,
    cells,
  };
}

export function analyzeMapReachability(text: string, options: MapReachabilityOptions = {}): MapReachabilityReport {
  return analyzeTileGridReachability(parseTileGrid(text), parseMapEntities(text), {
    ...options,
    blockingVolumes: options.blockingVolumes ?? [...parseMapVolumes(text), ...parseMapSolids(text)],
  });
}
