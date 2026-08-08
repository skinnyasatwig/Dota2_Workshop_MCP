import {
  applyTileGrid,
  cIndex,
  configureCellsFromHeights,
  fill,
  inShape,
  orientCellsFromHeights,
  parseTileGrid,
  setHeight,
  setPathEdges,
  setTileset,
  setWater,
  Shape,
} from "./tilegrid.js";

export type ManagedTerrainShape =
  | Shape
  | {
      kind: "managedPath";
      name: string;
      width: number;
    };

export type ManagedTerrainOperation =
  | { op: "fill"; level?: number; water?: boolean; tileset?: number }
  | { op: "height"; shape: ManagedTerrainShape; level: number; dome?: boolean }
  | { op: "water"; shape: ManagedTerrainShape; on?: boolean; invert?: boolean }
  | { op: "tileset"; shape: ManagedTerrainShape; tileset: number }
  | { op: "ramp"; shape: ManagedTerrainShape };

export interface TerrainPathReference {
  name: string;
  points: [number, number, number][];
}

export interface TerrainReconcileResult {
  text: string;
  changed: boolean;
  changedHeightVertices: number;
  changedWaterVertices: number;
  changedTilesetCells: number;
  changedOrientationCells: number;
  changedConfigurationCells: number;
  changedPathEdges: number;
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

function shape(value: unknown, field: string, path: string): ManagedTerrainShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be a shape object: ${path}`);
  }
  const raw = value as Record<string, unknown>;
  switch (raw.kind) {
    case "managedPath": {
      if (typeof raw.name !== "string" || !raw.name) {
        throw new Error(`${field}.name must be a non-empty string: ${path}`);
      }
      const width = finiteNumber(raw.width, `${field}.width`, path);
      if (width <= 0) throw new Error(`${field}.width must be positive: ${path}`);
      return { kind: "managedPath", name: raw.name, width };
    }
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
    case "polygon": {
      if (!Array.isArray(raw.points) || raw.points.length < 3) {
        throw new Error(`${field}.points must contain at least three [x, y] points: ${path}`);
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
      return { kind: "polygon", points };
    }
    default:
      throw new Error(`${field}.kind must be rect, circle, ring, path, polygon, or managedPath: ${path}`);
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
      case "ramp":
        return {
          op: "ramp",
          shape: shape(raw.shape, `${itemField}.shape`, path),
        };
      default:
        throw new Error(`${itemField}.op must be fill, height, water, tileset, or ramp: ${path}`);
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
  pathReferences: TerrainPathReference[] = [],
): TerrainReconcileResult {
  if (!operations.length) {
    return {
      text,
      changed: false,
      changedHeightVertices: 0,
      changedWaterVertices: 0,
      changedTilesetCells: 0,
      changedOrientationCells: 0,
      changedConfigurationCells: 0,
      changedPathEdges: 0,
      operations: [],
    };
  }
  const terrain = parseTileGrid(text);
  const beforeHeight = [...terrain.heights];
  const beforeWater = [...terrain.water];
  const beforeTileset = [...terrain.tileset];
  const beforeOrientations = [...terrain.orientations];
  const beforeConfigurations = terrain.configurations.map((configuration) => [...configuration]);
  const beforePathEdges = [...terrain.pathEdges];
  const results: TerrainReconcileResult["operations"] = [];
  const pathsByName = new Map(pathReferences.map((path) => [path.name, path]));
  const rampCells = new Set<number>();
  const concreteShape = (managedShape: ManagedTerrainShape): Shape => {
    if (managedShape.kind !== "managedPath") return managedShape;
    const reference = pathsByName.get(managedShape.name);
    if (!reference) {
      throw new Error(`Managed terrain references missing path "${managedShape.name}".`);
    }
    return {
      kind: "path",
      points: reference.points.map(([x, y]) => [
        (x - terrain.origin[0]) / terrain.tileSize,
        (y - terrain.origin[1]) / terrain.tileSize,
      ]),
      width: managedShape.width,
    };
  };

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
        touched = setHeight(
          terrain,
          concreteShape(operation.shape),
          operation.level,
          operation.dome === true,
        );
        break;
      case "water":
        touched = setWater(
          terrain,
          concreteShape(operation.shape),
          operation.on !== false,
          operation.invert === true,
        );
        break;
      case "tileset":
        touched = setTileset(terrain, concreteShape(operation.shape), operation.tileset);
        break;
      case "ramp": {
        const rampShape = concreteShape(operation.shape);
        touched = setPathEdges(terrain, rampShape, true);
        for (let cy = 0; cy < terrain.height; cy++) {
          for (let cx = 0; cx < terrain.width; cx++) {
            if (inShape(rampShape, cx + 0.5, cy + 0.5)) {
              rampCells.add(cIndex(terrain, cx, cy));
            }
          }
        }
        break;
      }
    }
    results.push({ index, op: operation.op, touched });
  }

  orientCellsFromHeights(terrain);
  configureCellsFromHeights(terrain, rampCells);
  const changedHeightVertices = changedValues(beforeHeight, terrain.heights);
  const changedWaterVertices = changedValues(beforeWater, terrain.water);
  const changedTilesetCells = changedValues(beforeTileset, terrain.tileset);
  const changedOrientationCells = changedValues(beforeOrientations, terrain.orientations);
  const changedConfigurationCells = beforeConfigurations.reduce(
    (changed, configuration, index) =>
      changed +
      (configuration.length !== terrain.configurations[index]?.length ||
      configuration.some((value, entry) => value !== terrain.configurations[index]?.[entry])
        ? 1
        : 0),
    0,
  );
  const changedPathEdges = changedValues(beforePathEdges, terrain.pathEdges);
  const changed =
    changedHeightVertices +
      changedWaterVertices +
      changedTilesetCells +
      changedOrientationCells +
      changedConfigurationCells +
      changedPathEdges >
    0;
  return {
    text: changed ? applyTileGrid(text, terrain) : text,
    changed,
    changedHeightVertices,
    changedWaterVertices,
    changedTilesetCells,
    changedOrientationCells,
    changedConfigurationCells,
    changedPathEdges,
    operations: results,
  };
}
