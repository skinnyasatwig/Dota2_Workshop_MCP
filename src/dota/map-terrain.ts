import {
  applyTileGrid,
  fill,
  parseTileGrid,
  setHeight,
  setTileset,
  setWater,
  Shape,
} from "./tilegrid.js";

export type ManagedTerrainOperation =
  | { op: "fill"; level?: number; water?: boolean; tileset?: number }
  | { op: "height"; shape: Shape; level: number; dome?: boolean }
  | { op: "water"; shape: Shape; on?: boolean; invert?: boolean }
  | { op: "tileset"; shape: Shape; tileset: number };

export interface TerrainReconcileResult {
  text: string;
  changed: boolean;
  changedHeightVertices: number;
  changedWaterVertices: number;
  changedTilesetCells: number;
  operations: {
    index: number;
    op: ManagedTerrainOperation["op"];
    touched: number;
  }[];
}

function finiteNumber(value: unknown, field: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number: ${path}`);
  }
  return value;
}

function integer(value: unknown, field: string, path: string, minimum?: number): number {
  const parsed = finiteNumber(value, field, path);
  if (!Number.isInteger(parsed) || (minimum !== undefined && parsed < minimum)) {
    const minimumText = minimum === undefined ? "" : ` at least ${minimum}`;
    throw new Error(`${field} must be an integer${minimumText}: ${path}`);
  }
  return parsed;
}

function shape(value: unknown, field: string, path: string): Shape {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be a shape object: ${path}`);
  }
  const raw = value as Record<string, unknown>;
  switch (raw.kind) {
    case "rect":
      return {
        kind: "rect",
        x0: finiteNumber(raw.x0, `${field}.x0`, path),
        y0: finiteNumber(raw.y0, `${field}.y0`, path),
        x1: finiteNumber(raw.x1, `${field}.x1`, path),
        y1: finiteNumber(raw.y1, `${field}.y1`, path),
      };
    case "circle": {
      const radius = finiteNumber(raw.r, `${field}.r`, path);
      if (radius <= 0) throw new Error(`${field}.r must be positive: ${path}`);
      return {
        kind: "circle",
        cx: finiteNumber(raw.cx, `${field}.cx`, path),
        cy: finiteNumber(raw.cy, `${field}.cy`, path),
        r: radius,
      };
    }
    case "ring": {
      const inner = finiteNumber(raw.rInner, `${field}.rInner`, path);
      const outer = finiteNumber(raw.rOuter, `${field}.rOuter`, path);
      if (inner < 0 || outer <= inner) {
        throw new Error(`${field} requires 0 <= rInner < rOuter: ${path}`);
      }
      return {
        kind: "ring",
        cx: finiteNumber(raw.cx, `${field}.cx`, path),
        cy: finiteNumber(raw.cy, `${field}.cy`, path),
        rInner: inner,
        rOuter: outer,
      };
    }
    case "path": {
      if (!Array.isArray(raw.points) || raw.points.length < 2) {
        throw new Error(`${field}.points must contain at least two [x, y] points: ${path}`);
      }
      const points = raw.points.map((point, index) => {
        if (!Array.isArray(point) || point.length !== 2) {
          throw new Error(`${field}.points[${index}] must be [x, y]: ${path}`);
        }
        return [
          finiteNumber(point[0], `${field}.points[${index}][0]`, path),
          finiteNumber(point[1], `${field}.points[${index}][1]`, path),
        ] as [number, number];
      });
      const width = finiteNumber(raw.width, `${field}.width`, path);
      if (width <= 0) throw new Error(`${field}.width must be positive: ${path}`);
      return { kind: "path", points, width };
    }
    default:
      throw new Error(`${field}.kind must be rect, circle, ring, or path: ${path}`);
  }
}

export function parseManagedTerrain(
  value: unknown,
  field: string,
  path: string,
): ManagedTerrainOperation[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array: ${path}`);
  return value.map((entry, index) => {
    const itemField = `${field}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${itemField} must be an object: ${path}`);
    }
    const raw = entry as Record<string, unknown>;
    switch (raw.op) {
      case "fill": {
        if (raw.level === undefined && raw.water === undefined && raw.tileset === undefined) {
          throw new Error(`${itemField} must set level, water, or tileset: ${path}`);
        }
        if (raw.water !== undefined && typeof raw.water !== "boolean") {
          throw new Error(`${itemField}.water must be a boolean: ${path}`);
        }
        return {
          op: "fill",
          level: raw.level === undefined ? undefined : integer(raw.level, `${itemField}.level`, path),
          water: raw.water as boolean | undefined,
          tileset:
            raw.tileset === undefined
              ? undefined
              : integer(raw.tileset, `${itemField}.tileset`, path, 0),
        };
      }
      case "height":
        if (raw.dome !== undefined && typeof raw.dome !== "boolean") {
          throw new Error(`${itemField}.dome must be a boolean: ${path}`);
        }
        return {
          op: "height",
          shape: shape(raw.shape, `${itemField}.shape`, path),
          level: integer(raw.level, `${itemField}.level`, path),
          dome: raw.dome as boolean | undefined,
        };
      case "water":
        if (raw.on !== undefined && typeof raw.on !== "boolean") {
          throw new Error(`${itemField}.on must be a boolean: ${path}`);
        }
        if (raw.invert !== undefined && typeof raw.invert !== "boolean") {
          throw new Error(`${itemField}.invert must be a boolean: ${path}`);
        }
        return {
          op: "water",
          shape: shape(raw.shape, `${itemField}.shape`, path),
          on: raw.on as boolean | undefined,
          invert: raw.invert as boolean | undefined,
        };
      case "tileset":
        return {
          op: "tileset",
          shape: shape(raw.shape, `${itemField}.shape`, path),
          tileset: integer(raw.tileset, `${itemField}.tileset`, path, 0),
        };
      default:
        throw new Error(`${itemField}.op must be fill, height, water, or tileset: ${path}`);
    }
  });
}

function changedValues(before: number[], after: number[]): number {
  let changed = 0;
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    if (before[index] !== after[index]) changed++;
  }
  return changed;
}

export function reconcileMapTerrain(
  text: string,
  operations: ManagedTerrainOperation[],
): TerrainReconcileResult {
  if (!operations.length) {
    return {
      text,
      changed: false,
      changedHeightVertices: 0,
      changedWaterVertices: 0,
      changedTilesetCells: 0,
      operations: [],
    };
  }
  const terrain = parseTileGrid(text);
  const beforeHeight = [...terrain.heights];
  const beforeWater = [...terrain.water];
  const beforeTileset = [...terrain.tileset];
  const results: TerrainReconcileResult["operations"] = [];

  for (const [index, operation] of operations.entries()) {
    let touched = 0;
    switch (operation.op) {
      case "fill":
        fill(terrain, {
          height: operation.level,
          water: operation.water,
          tileset: operation.tileset,
        });
        touched =
          (operation.level === undefined ? 0 : terrain.heights.length) +
          (operation.water === undefined ? 0 : terrain.water.length) +
          (operation.tileset === undefined ? 0 : terrain.tileset.length);
        break;
      case "height":
        touched = setHeight(terrain, operation.shape, operation.level, operation.dome === true);
        break;
      case "water":
        touched = setWater(
          terrain,
          operation.shape,
          operation.on !== false,
          operation.invert === true,
        );
        break;
      case "tileset":
        touched = setTileset(terrain, operation.shape, operation.tileset);
        break;
    }
    results.push({ index, op: operation.op, touched });
  }

  const changedHeightVertices = changedValues(beforeHeight, terrain.heights);
  const changedWaterVertices = changedValues(beforeWater, terrain.water);
  const changedTilesetCells = changedValues(beforeTileset, terrain.tileset);
  const changed = changedHeightVertices + changedWaterVertices + changedTilesetCells > 0;
  return {
    text: changed ? applyTileGrid(text, terrain) : text,
    changed,
    changedHeightVertices,
    changedWaterVertices,
    changedTilesetCells,
    operations: results,
  };
}
