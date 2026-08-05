import { encodeRgbaPng } from "../util/png.js";
import {
  analyzeTileGridReachability,
  classifyReachabilityEntity,
  MapReachabilityReport,
} from "./map-reachability.js";
import { cIndex, parseTileGrid, TileGrid, vIndex } from "./tilegrid.js";
import { parseMapEntities, ParsedMapEntity } from "./vmap.js";
import { parseMapVolumes, ParsedMapVolume } from "./map-volume.js";
import { MapCollisionObstacle } from "./map-collision.js";

export interface MapPreviewOptions {
  scale?: number;
  showContours?: boolean;
  showCliffs?: boolean;
  showRamps?: boolean;
  showEntities?: boolean;
  showPaths?: boolean;
  showTowerRanges?: boolean;
  showCamps?: boolean;
  showObjectives?: boolean;
  showCurrents?: boolean;
  showMinimapBounds?: boolean;
  showReachability?: boolean;
  showVolumes?: boolean;
  showVisionBlockers?: boolean;
  showCollisionObstacles?: boolean;
  /** Pre-resolved physical/class collision inventory supplied by the async tools. */
  collisionObstacles?: readonly MapCollisionObstacle[];
}

export interface MapPreviewStats {
  width: number;
  height: number;
  grid: [number, number];
  waterCells: number;
  raisedVertices: number;
  alternateTilesetCells: number;
  cliffCells: number;
  rampCells: number;
  unreachableCells: number;
  holeCells: number;
  overlays: {
    entities: number;
    paths: number;
    towers: number;
    camps: number;
    objectives: number;
    currents: number;
    minimapBounds: number;
    volumes: number;
    slopedVolumes: number;
    blockingVolumes: number;
    visionBlockers: number;
    collisionObstacles: number;
  };
  legend: Record<string, string>;
}

export interface RenderedMapPreview {
  png: Buffer;
  stats: MapPreviewStats;
  reachability: MapReachabilityReport;
}

type Color = [number, number, number];

function vector3(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts as [number, number, number];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function drawPreview(
  grid: TileGrid,
  entities: ParsedMapEntity[],
  options: MapPreviewOptions,
  volumes: readonly ParsedMapVolume[] = [],
): RenderedMapPreview {
  const scale = Math.max(2, Math.min(16, Math.floor(options.scale ?? 8)));
  const width = grid.width * scale;
  const height = grid.height * scale;
  const rgba = Buffer.alloc(width * height * 4);
  const reachability = analyzeTileGridReachability(grid, entities, {
    blockingVolumes: volumes,
    collisionObstacles: options.collisionObstacles,
  });
  const reachableComponents = new Set(reachability.spawnComponents.length
    ? reachability.spawnComponents
    : reachability.primaryComponent === undefined ? [] : [reachability.primaryComponent]);

  const put = (x: number, y: number, color: Color, alpha = 1): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (Math.floor(y) * width + Math.floor(x)) * 4;
    rgba[index] = clampByte(rgba[index] * (1 - alpha) + color[0] * alpha);
    rgba[index + 1] = clampByte(rgba[index + 1] * (1 - alpha) + color[1] * alpha);
    rgba[index + 2] = clampByte(rgba[index + 2] * (1 - alpha) + color[2] * alpha);
    rgba[index + 3] = 255;
  };
  const line = (x0: number, y0: number, x1: number, y1: number, color: Color, alpha = 1, thickness = 1): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let step = 0; step <= steps; step++) {
      const amount = step / steps;
      const x = Math.round(x0 + dx * amount);
      const y = Math.round(y0 + dy * amount);
      for (let oy = -Math.floor(thickness / 2); oy <= Math.floor(thickness / 2); oy++) {
        for (let ox = -Math.floor(thickness / 2); ox <= Math.floor(thickness / 2); ox++) put(x + ox, y + oy, color, alpha);
      }
    }
  };
  const circle = (cx: number, cy: number, radius: number, color: Color, alpha = 1, thickness = 1): void => {
    const steps = Math.max(20, Math.ceil(radius * Math.PI * 2));
    let previous: [number, number] | undefined;
    for (let step = 0; step <= steps; step++) {
      const angle = (step / steps) * Math.PI * 2;
      const point: [number, number] = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
      if (previous) line(previous[0], previous[1], point[0], point[1], color, alpha, thickness);
      previous = point;
    }
  };
  const marker = (x: number, y: number, color: Color, radius = 2): void => {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy <= radius * radius) put(x + ox, y + oy, color);
      }
    }
  };
  const worldPixel = (origin: [number, number, number]): [number, number] => {
    const gridX = (origin[0] - grid.origin[0]) / grid.tileSize;
    const gridY = (origin[1] - grid.origin[1]) / grid.tileSize;
    return [gridX * scale, (grid.height - gridY) * scale];
  };

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const corners = [
        vIndex(grid, x, y),
        vIndex(grid, x + 1, y),
        vIndex(grid, x, y + 1),
        vIndex(grid, x + 1, y + 1),
      ];
      const water = corners.filter((index) => grid.water[index]).length >= 2;
      const averageHeight = corners.reduce((sum, index) => sum + (grid.heights[index] ?? 0), 0) / 4;
      const tileset = grid.tileset[cIndex(grid, x, y)] ?? 0;
      const base: Color = water ? [38, 91, 150] : tileset ? [166, 143, 96] : [68, 116, 54];
      const shade = 1 + Math.max(-0.3, Math.min(0.55, averageHeight * 0.16));
      const color: Color = [base[0] * shade, base[1] * shade, base[2] * shade].map(clampByte) as Color;
      const imageY = (grid.height - 1 - y) * scale;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) put(x * scale + px, imageY + py, color);
      }
    }
  }

  const showReachability = options.showReachability !== false;
  for (const cell of reachability.cells) {
    const imageX = cell.x * scale;
    const imageY = (grid.height - 1 - cell.y) * scale;
    const unreachable = cell.walkable && cell.component !== undefined && !reachableComponents.has(cell.component);
    if (showReachability && unreachable) {
      for (let offset = -scale; offset < scale * 2; offset += 4) {
        line(imageX + offset, imageY + scale, imageX + offset + scale, imageY, [220, 45, 45], 0.65);
      }
    }
    if (showReachability && cell.hole) {
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) put(imageX + px, imageY + py, (px + py) % 2 ? [255, 0, 190] : [20, 20, 20], 0.9);
      }
    }
    if (options.showCliffs !== false && cell.cliff) {
      line(imageX, imageY, imageX + scale - 1, imageY, [28, 24, 21], 0.95, 2);
      line(imageX, imageY + scale - 1, imageX + scale - 1, imageY + scale - 1, [28, 24, 21], 0.95, 2);
      line(imageX, imageY, imageX, imageY + scale - 1, [28, 24, 21], 0.95, 2);
      line(imageX + scale - 1, imageY, imageX + scale - 1, imageY + scale - 1, [28, 24, 21], 0.95, 2);
    }
    if (options.showRamps !== false && cell.ramp) {
      line(imageX, imageY + scale - 1, imageX + scale - 1, imageY, [255, 216, 64], 0.95, 2);
    }
  }

  if (options.showContours !== false) {
    const cells = reachability.cells;
    for (const cell of cells) {
      const index = cIndex(grid, cell.x, cell.y);
      const imageX = cell.x * scale;
      const imageY = (grid.height - 1 - cell.y) * scale;
      if (cell.x + 1 < grid.width && Math.abs(cell.height - cells[index + 1].height) > 0.01) {
        line(imageX + scale - 1, imageY, imageX + scale - 1, imageY + scale - 1, [245, 239, 196], 0.55);
      }
      if (cell.y + 1 < grid.height && Math.abs(cell.height - cells[index + grid.width].height) > 0.01) {
        line(imageX, imageY, imageX + scale - 1, imageY, [245, 239, 196], 0.55);
      }
    }
  }

  if (options.showVolumes !== false) {
    for (const volume of volumes) {
      const radians = (volume.yaw * Math.PI) / 180;
      const corners: [number, number, number][] = volume.footprint.map(([localX, localY]) => [
        volume.center[0] + localX * Math.cos(radians) - localY * Math.sin(radians),
        volume.center[1] + localX * Math.sin(radians) + localY * Math.cos(radians),
        volume.center[2],
      ]);
      const pixels = corners.map(worldPixel);
      const color: Color = volume.blocking
        ? [255, 55, 120]
        : volume.recipe === "noWards"
          ? [182, 92, 255]
          : volume.recipe === "camp"
            ? [255, 166, 48]
            : [57, 232, 255];
      for (let index = 0; index < pixels.length; index++) {
        const from = pixels[index];
        const to = pixels[(index + 1) % pixels.length];
        line(from[0], from[1], to[0], to[1], color, 0.9, volume.blocking ? 2 : 1);
      }
      if (volume.sloped) {
        const centerHeights = volume.sloped.top.map((height, index) =>
          (height + volume.sloped!.bottom[index]) / 2);
        const low = centerHeights.indexOf(Math.min(...centerHeights));
        const high = centerHeights.indexOf(Math.max(...centerHeights));
        if (low !== high) {
          const from = pixels[low];
          const to = pixels[high];
          line(from[0], from[1], to[0], to[1], [245, 239, 196], 0.9, 1);
          const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
          line(to[0], to[1], to[0] - Math.cos(angle - 0.55) * 4, to[1] - Math.sin(angle - 0.55) * 4, [245, 239, 196]);
          line(to[0], to[1], to[0] - Math.cos(angle + 0.55) * 4, to[1] - Math.sin(angle + 0.55) * 4, [245, 239, 196]);
        }
      }
    }
  }

  if (options.showCollisionObstacles !== false) {
    for (const obstacle of reachability.collisionObstacles) {
      const [x, y] = worldPixel(obstacle.origin);
      if (obstacle.confidence === "physical-model-bounds" && obstacle.physicalFootprints) {
        for (const footprint of obstacle.physicalFootprints) {
          const pixels = footprint.points.map(([worldX, worldY]) =>
            worldPixel([worldX, worldY, obstacle.origin[2]]));
          for (let index = 0; index < pixels.length; index++) {
            const from = pixels[index];
            const to = pixels[(index + 1) % pixels.length];
            const color: Color = footprint.projection === "exact-hull"
              ? [57, 232, 255]
              : footprint.projection === "mesh-vertex-hull"
                ? [82, 189, 214]
                : footprint.projection === "curved-primitive"
                  ? [91, 220, 173]
                  : [61, 146, 176];
            line(from[0], from[1], to[0], to[1], color, 0.95, 2);
          }
        }
      } else if (obstacle.approximateRadius !== undefined) {
        circle(
          x,
          y,
          Math.max(2, (obstacle.approximateRadius / grid.tileSize) * scale),
          obstacle.kind === "tree" ? [35, 66, 24] : [255, 92, 45],
          0.95,
          2,
        );
      } else {
        line(x - 3, y - 3, x + 3, y + 3, [235, 235, 235], 0.9, 1);
        line(x - 3, y + 3, x + 3, y - 3, [235, 235, 235], 0.9, 1);
      }
    }
  }

  const named = entities.filter((entity) => entity.targetname && vector3(entity.origin));
  const towers = named.filter((entity) => entity.classname === "npc_dota_tower");
  if (options.showTowerRanges !== false) {
    for (const tower of towers) {
      const origin = vector3(tower.origin)!;
      const [x, y] = worldPixel(origin);
      const range = Number(tower.properties.attack_range ?? tower.properties.AttackRange ?? 700);
      const color: Color = tower.properties.teamnumber === "3" ? [239, 82, 74] : [45, 212, 160];
      circle(x, y, (range / grid.tileSize) * scale, color, 0.65, 1);
    }
  }

  const pathEntities = named.filter((entity) => ["path_corner", "path_track"].includes(entity.classname));
  const pathByName = new Map(pathEntities.map((entity) => [entity.targetname!, entity]));
  let pathSegments = 0;
  if (options.showPaths !== false) {
    for (const path of pathEntities) {
      if (!path.target) continue;
      const next = pathByName.get(path.target);
      const from = vector3(path.origin);
      const to = vector3(next?.origin);
      if (!from || !to) continue;
      const [x0, y0] = worldPixel(from);
      const [x1, y1] = worldPixel(to);
      const color: Color = /dire/.test(path.targetname!) ? [248, 112, 96] : /radiant/.test(path.targetname!) ? [45, 212, 160] : [245, 245, 245];
      line(x0, y0, x1, y1, color, 0.9, 2);
      pathSegments++;
    }
  }

  const visionNodes = named.filter((entity) => entity.classname === "ent_fow_blocker_node");
  const visionByName = new Map(visionNodes.map((entity) => [entity.targetname!, entity]));
  let visionBlockerSegments = 0;
  if (options.showVisionBlockers !== false) {
    for (const node of visionNodes) {
      const targetName = node.properties.TargetNode;
      const target = targetName ? visionByName.get(targetName) : undefined;
      const from = vector3(node.origin);
      const to = vector3(target?.origin);
      if (!from || !to) continue;
      const [x0, y0] = worldPixel(from);
      const [x1, y1] = worldPixel(to);
      line(x0, y0, x1, y1, [155, 88, 255], 0.9, 2);
      visionBlockerSegments++;
    }
  }

  const minimap = named.filter((entity) => entity.classname === "dota_minimap_boundary");
  let minimapBounds = 0;
  if (options.showMinimapBounds !== false && minimap.length >= 2) {
    const points = minimap.map((entity) => worldPixel(vector3(entity.origin)!));
    const minX = Math.min(...points.map((point) => point[0]));
    const maxX = Math.max(...points.map((point) => point[0]));
    const minY = Math.min(...points.map((point) => point[1]));
    const maxY = Math.max(...points.map((point) => point[1]));
    line(minX, minY, maxX, minY, [255, 70, 225], 1, 2);
    line(maxX, minY, maxX, maxY, [255, 70, 225], 1, 2);
    line(maxX, maxY, minX, maxY, [255, 70, 225], 1, 2);
    line(minX, maxY, minX, minY, [255, 70, 225], 1, 2);
    minimapBounds = 1;
  }

  let campCount = 0;
  let objectiveCount = 0;
  let currentCount = 0;
  if (options.showEntities !== false) {
    for (const entity of named) {
      if (["path_corner", "path_track", "dota_minimap_boundary"].includes(entity.classname)) continue;
      const origin = vector3(entity.origin)!;
      const [x, y] = worldPixel(origin);
      const kind = classifyReachabilityEntity(entity);
      let color: Color = [215, 215, 215];
      let radius = 2;
      if (kind === "spawn") color = [106, 255, 121];
      else if (kind === "entrance") color = [255, 255, 255];
      else if (kind === "camp") {
        color = [255, 166, 48];
        radius = 3;
        campCount++;
      } else if (kind === "objective") {
        color = entity.classname === "npc_dota_tower" ? [255, 225, 80] : [186, 92, 255];
        radius = 3;
        objectiveCount++;
      }
      if (kind === "camp" && options.showCamps === false) continue;
      if (kind === "objective" && options.showObjectives === false) continue;
      marker(x, y, color, radius);
      if (kind === "entrance") {
        line(x - 3, y, x + 3, y, color);
        line(x, y - 3, x, y + 3, color);
      }

      if (options.showCurrents !== false && /river_flow|current/.test(entity.targetname!.toLowerCase())) {
        const angles = vector3(entity.angles) ?? [0, 0, 0];
        const yaw = (angles[1] * Math.PI) / 180;
        const length = Math.max(6, scale * 1.5);
        const toX = x + Math.cos(yaw) * length;
        const toY = y - Math.sin(yaw) * length;
        line(x, y, toX, toY, [57, 232, 255], 1, 2);
        const arrowAngle = Math.atan2(toY - y, toX - x);
        line(toX, toY, toX - Math.cos(arrowAngle - 0.6) * 4, toY - Math.sin(arrowAngle - 0.6) * 4, [57, 232, 255]);
        line(toX, toY, toX - Math.cos(arrowAngle + 0.6) * 4, toY - Math.sin(arrowAngle + 0.6) * 4, [57, 232, 255]);
        currentCount++;
      }
    }
  }

  const stats: MapPreviewStats = {
    width,
    height,
    grid: [grid.width, grid.height],
    waterCells: reachability.waterCellCount,
    raisedVertices: grid.heights.filter((value) => value > 0).length,
    alternateTilesetCells: grid.tileset.filter((value) => value !== 0).length,
    cliffCells: reachability.cliffCellCount,
    rampCells: reachability.rampCellCount,
    unreachableCells: reachability.unreachableCellCount,
    holeCells: reachability.holeCellCount,
    overlays: {
      entities: named.length - pathEntities.length - minimap.length,
      paths: pathSegments,
      towers: towers.length,
      camps: campCount,
      objectives: objectiveCount,
      currents: currentCount,
      minimapBounds,
      volumes: volumes.length,
      slopedVolumes: volumes.filter((volume) => !!volume.sloped).length,
      blockingVolumes: volumes.filter((volume) => volume.blocking).length,
      visionBlockers: visionBlockerSegments,
      collisionObstacles: reachability.collisionObstacleCount,
    },
    legend: {
      water: "blue",
      cliffs: "dark outlined cells",
      ramps: "yellow diagonal cells",
      unreachable: "red hatched cells",
      holes: "magenta/black cells",
      paths: "teal Radiant, coral Dire",
      towerRanges: "teal/coral circles",
      camps: "orange markers",
      objectives: "yellow/purple markers",
      currents: "cyan arrows",
      minimapBounds: "magenta rectangle",
      volumes: "orange camp, purple no-ward, cyan trigger, pink player blocker outlines; pale arrows point uphill on sloped volumes",
      visionBlockers: "purple linked lines",
      collisionObstacles: "bright cyan exact PHYS hulls; medium cyan mesh envelopes; green-cyan conservative curved primitives; muted cyan PHYS bounds; dark green/orange class approximations; white X means model bounds unknown",
    },
  };
  return { png: encodeRgbaPng(width, height, rgba), stats, reachability };
}

export function renderMapPreview(text: string, options: MapPreviewOptions = {}): RenderedMapPreview {
  return drawPreview(parseTileGrid(text), parseMapEntities(text), options, parseMapVolumes(text));
}

export function renderTileGridPreview(
  grid: TileGrid,
  entities: ParsedMapEntity[],
  options: MapPreviewOptions = {},
  volumes: readonly ParsedMapVolume[] = [],
): RenderedMapPreview {
  return drawPreview(grid, entities, options, volumes);
}
