// Programmatic terrain authoring for the Dota tile grid (CMapDotaTileGrid).
import {
  cornerPattern,
  orientationForCornerPattern,
  terrainRecipeForCell,
} from "./terrain-recipes.js";

//
// The ground is a grid of W x H cells with (W+1) x (H+1) vertices. We parse the
// editable arrays out of a vmap's kv2 text, mutate them with shape ops (rect / circle /
// ring / path-stroke), and write them back. Verified: heights + water render in-game.
//
// Coordinates: tile space. Vertex (vx,vy) in [0..W] x [0..H]; cell (cx,cy) in
// [0..W-1] x [0..H-1]. World = origin + tile * tileSize (tileSize defaults to 256u:
// the template grid spans 16384u over 64 tiles).

export interface TileGrid {
  width: number; // cells X (gridWidth)
  height: number; // cells Y (gridHeight)
  vw: number; // vertices X = width+1
  vh: number; // vertices Y = height+1
  origin: [number, number, number];
  tileSize: number;
  heights: number[]; // length vw*vh, integer levels
  water: number[]; // length vw*vh, 0/1
  tileset: number[]; // length width*height, index into tileSetMapInfo
  orientations: number[]; // length width*height, quarter-turn cliff-tile orientation
  configurations: number[][]; // one variable-length tile recipe per cell
  pathEdges: number[]; // horizontal edges, then vertical edges; 0/1
}

const TILE_SIZE = 256;

function intArray(text: string, key: string): number[] | null {
  const m = text.match(new RegExp('"' + key + '" "int_array"\\s*\\[([\\s\\S]*?)\\]'));
  return m ? (m[1].match(/-?\d+/g) || []).map(Number) : null;
}
function boolArray(text: string, key: string): number[] | null {
  const m = text.match(new RegExp('"' + key + '" "bool_array"\\s*\\[([\\s\\S]*?)\\]'));
  return m ? (m[1].match(/\b[01]\b|true|false/g) || []).map((v) => (v === "1" || v === "true" ? 1 : 0)) : null;
}

function configurationArray(text: string, key: string, cellCount: number): number[][] | null {
  const packed = intArray(text, key);
  if (!packed) return null;
  const records: number[][] = [];
  for (let offset = 0; offset < packed.length && records.length < cellCount;) {
    const valueCount = packed[offset];
    if (valueCount < 0 || offset + valueCount >= packed.length) {
      throw new Error(`Invalid ${key} record ${records.length}: length ${valueCount}.`);
    }
    records.push(packed.slice(offset + 1, offset + 1 + valueCount));
    offset += valueCount + 1;
  }
  if (records.length !== cellCount) {
    throw new Error(`${key} has ${records.length} records; expected ${cellCount}.`);
  }
  return records;
}

export function parseTileGrid(text: string): TileGrid {
  const gw = text.match(/"gridWidth" "int" "(\d+)"/);
  const gh = text.match(/"gridHeight" "int" "(\d+)"/);
  if (!gw || !gh) throw new Error("No CMapDotaTileGrid (gridWidth/Height) found in this map.");
  const width = Number(gw[1]);
  const height = Number(gh[1]);
  const om = text.match(/"CMapDotaTileGrid"[\s\S]*?"origin" "vector3" "([^"]+)"/);
  const origin = (om ? om[1].split(/\s+/).map(Number) : [0, 0, 0]) as [number, number, number];
  const heights = intArray(text, "verticesHeight");
  const water = boolArray(text, "verticesWater");
  const tileset = intArray(text, "cellsTileSet");
  const orientations = intArray(text, "cellsOrientation") ?? new Array(width * height).fill(0);
  const configurations =
    configurationArray(text, "cellConfiguration", width * height) ??
    new Array(width * height).fill(undefined).map(() => [5292, -1]);
  const pathEdges =
    boolArray(text, "edgesPath") ??
    new Array(width * (height + 1) + (width + 1) * height).fill(0);
  if (!heights || !water || !tileset) throw new Error("Tile grid arrays missing (verticesHeight/verticesWater/cellsTileSet).");
  return {
    width,
    height,
    vw: width + 1,
    vh: height + 1,
    origin,
    tileSize: TILE_SIZE,
    heights,
    water,
    tileset,
    orientations,
    configurations,
    pathEdges,
  };
}

export function applyTileGrid(text: string, g: TileGrid): string {
  const repl = (key: string, type: string, vals: number[]) =>
    text.replace(
      new RegExp('("' + key + '" "' + type + '"\\s*\\[)[\\s\\S]*?(\\])'),
      "$1\n" + vals.map((v) => '"' + v + '"').join(",\n") + "\n$2",
    );
  text = repl("verticesHeight", "int_array", g.heights);
  text = repl("verticesWater", "bool_array", g.water);
  text = repl("cellsTileSet", "int_array", g.tileset);
  text = repl("cellsOrientation", "int_array", g.orientations);
  text = repl(
    "cellConfiguration",
    "int_array",
    g.configurations.flatMap((configuration) => [configuration.length, ...configuration]),
  );
  text = repl("edgesPath", "bool_array", g.pathEdges);
  return text;
}

// --- index helpers ---
export const vIndex = (g: TileGrid, vx: number, vy: number) => vy * g.vw + vx;
export const cIndex = (g: TileGrid, cx: number, cy: number) => cy * g.width + cx;
export function tileToWorld(g: TileGrid, vx: number, vy: number): [number, number] {
  return [g.origin[0] + vx * g.tileSize, g.origin[1] + vy * g.tileSize];
}

// --- shape predicates over a coordinate (in tile units) ---
export type Shape =
  | { kind: "rect"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "ring"; cx: number; cy: number; rInner: number; rOuter: number }
  | { kind: "path"; points: [number, number][]; width: number }
  | { kind: "polygon"; points: [number, number][] };

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function inShape(s: Shape, x: number, y: number): boolean {
  switch (s.kind) {
    case "rect":
      return x >= Math.min(s.x0, s.x1) && x <= Math.max(s.x0, s.x1) && y >= Math.min(s.y0, s.y1) && y <= Math.max(s.y0, s.y1);
    case "circle":
      return Math.hypot(x - s.cx, y - s.cy) <= s.r;
    case "ring": {
      const d = Math.hypot(x - s.cx, y - s.cy);
      return d >= s.rInner && d <= s.rOuter;
    }
    case "path": {
      for (let i = 0; i < s.points.length - 1; i++) {
        if (distToSegment(x, y, s.points[i][0], s.points[i][1], s.points[i + 1][0], s.points[i + 1][1]) <= s.width / 2) return true;
      }
      return false;
    }
    case "polygon": {
      let inside = false;
      for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
        const [xi, yi] = s.points[i];
        const [xj, yj] = s.points[j];
        const intersects =
          yi > y !== yj > y &&
          x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
        if (intersects) inside = !inside;
      }
      return inside;
    }
  }
}

// --- region operations ---
/** Set vertex height for all vertices inside the shape (optionally a domed peak for circles). */
export function setHeight(g: TileGrid, shape: Shape, level: number, dome = false): number {
  let n = 0;
  for (let vy = 0; vy < g.vh; vy++) {
    for (let vx = 0; vx < g.vw; vx++) {
      if (!inShape(shape, vx, vy)) continue;
      let h = level;
      if (dome && shape.kind === "circle") {
        const d = Math.hypot(vx - shape.cx, vy - shape.cy);
        h = Math.round(((shape.r - d) / shape.r) * level);
      }
      g.heights[vIndex(g, vx, vy)] = h;
      n++;
    }
  }
  return n;
}

/** Toggle water for vertices inside (or, with invert, outside) the shape. */
export function setWater(g: TileGrid, shape: Shape, on: boolean, invert = false): number {
  let n = 0;
  for (let vy = 0; vy < g.vh; vy++) {
    for (let vx = 0; vx < g.vw; vx++) {
      const inside = inShape(shape, vx, vy);
      if (invert ? inside : !inside) continue;
      g.water[vIndex(g, vx, vy)] = on ? 1 : 0;
      n++;
    }
  }
  return n;
}

/** Paint a tileset index onto cells inside the shape (cell center tested). */
export function setTileset(g: TileGrid, shape: Shape, tilesetIndex: number): number {
  let n = 0;
  for (let cy = 0; cy < g.height; cy++) {
    for (let cx = 0; cx < g.width; cx++) {
      if (!inShape(shape, cx + 0.5, cy + 0.5)) continue;
      g.tileset[cIndex(g, cx, cy)] = tilesetIndex;
      n++;
    }
  }
  return n;
}

/** Mark every edge around cells in a shape as a Tile Editor road/ramp edge. */
export function setPathEdges(g: TileGrid, shape: Shape, on: boolean): number {
  const horizontalCount = g.width * (g.height + 1);
  const horizontal = (x: number, y: number) => y * g.width + x;
  const vertical = (x: number, y: number) => horizontalCount + y * (g.width + 1) + x;
  let changed = 0;
  const value = on ? 1 : 0;
  for (let cy = 0; cy < g.height; cy++) {
    for (let cx = 0; cx < g.width; cx++) {
      if (!inShape(shape, cx + 0.5, cy + 0.5)) continue;
      for (const index of [
        horizontal(cx, cy),
        horizontal(cx, cy + 1),
        vertical(cx, cy),
        vertical(cx + 1, cy),
      ]) {
        if (g.pathEdges[index] === value) continue;
        g.pathEdges[index] = value;
        changed++;
      }
    }
  }
  return changed;
}

/**
 * Rotate cliff cells to match their raised corners. Hammer normally performs
 * this bookkeeping while painting terrain; programmatic height edits must do
 * it explicitly or Source 2 can select an incompatible/missing cliff mesh.
 */
export function orientCellsFromHeights(g: TileGrid): number {
  let touched = 0;
  for (let cy = 0; cy < g.height; cy++) {
    for (let cx = 0; cx < g.width; cx++) {
      const corners = [
        g.heights[vIndex(g, cx, cy)],
        g.heights[vIndex(g, cx + 1, cy)],
        g.heights[vIndex(g, cx, cy + 1)],
        g.heights[vIndex(g, cx + 1, cy + 1)],
      ];
      const pattern = cornerPattern(corners);
      g.orientations[cIndex(g, cx, cy)] = orientationForCornerPattern(pattern);
      touched++;
    }
  }
  return touched;
}

/**
 * Select the core Dota terrain tile whose corner profile matches each cell.
 * These node ids are shared by Valve's radiant_basic and dire_basic tile sets.
 * Decorative cliff pieces can be layered later; the core tile prevents edited
 * cells from falling back to a flat recipe with missing ground geometry.
 */
export function configureCellsFromHeights(g: TileGrid, rampCells: ReadonlySet<number> = new Set()): number {
  let changed = 0;
  for (let cy = 0; cy < g.height; cy++) {
    for (let cx = 0; cx < g.width; cx++) {
      const corners = [
        g.heights[vIndex(g, cx, cy)],
        g.heights[vIndex(g, cx + 1, cy)],
        g.heights[vIndex(g, cx, cy + 1)],
        g.heights[vIndex(g, cx + 1, cy + 1)],
      ];
      const pattern = cornerPattern(corners);
      const index = cIndex(g, cx, cy);
      const next = terrainRecipeForCell(pattern, g.tileset[index] ?? 0, rampCells.has(index));
      const current = g.configurations[index] ?? [];
      if (current.length !== next.length || current.some((value, entry) => value !== next[entry])) {
        g.configurations[index] = next;
        changed++;
      }
    }
  }
  return changed;
}

/** Fill the whole grid to a height/water baseline (e.g. all water for an ocean). */
export function fill(g: TileGrid, opts: { height?: number; water?: boolean; tileset?: number }): void {
  if (opts.height !== undefined) g.heights.fill(opts.height);
  if (opts.water !== undefined) g.water.fill(opts.water ? 1 : 0);
  if (opts.tileset !== undefined) g.tileset.fill(opts.tileset);
}
