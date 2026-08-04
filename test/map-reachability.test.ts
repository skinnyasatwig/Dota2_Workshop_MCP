import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTileGridReachability,
  classifyReachabilityEntity,
} from "../src/dota/map-reachability.js";
import { cIndex, TileGrid, vIndex } from "../src/dota/tilegrid.js";
import { ParsedMapEntity } from "../src/dota/vmap.js";

function flatGrid(width = 5, height = 3): TileGrid {
  return {
    width,
    height,
    vw: width + 1,
    vh: height + 1,
    origin: [0, 0, 0],
    tileSize: 256,
    heights: new Array((width + 1) * (height + 1)).fill(0),
    water: new Array((width + 1) * (height + 1)).fill(0),
    tileset: new Array(width * height).fill(0),
    orientations: new Array(width * height).fill(0),
    configurations: new Array(width * height).fill(undefined).map(() => [5292, -1]),
    pathEdges: new Array(width * (height + 1) + (width + 1) * height).fill(0),
  };
}

function entity(targetname: string, classname: string, x: number, y: number, target?: string): ParsedMapEntity {
  return {
    targetname,
    classname,
    origin: `${x} ${y} 128`,
    target,
    properties: { targetname, classname, ...(target ? { target } : {}) },
  };
}

function addVerticalCliff(grid: TileGrid, cellX: number): void {
  for (let y = 0; y < grid.vh; y++) {
    for (let x = cellX + 1; x < grid.vw; x++) grid.heights[vIndex(grid, x, y)] = 1;
  }
}

function markRamp(grid: TileGrid, x: number, y: number): void {
  const horizontalCount = grid.width * (grid.height + 1);
  const horizontal = (edgeX: number, edgeY: number) => edgeY * grid.width + edgeX;
  const vertical = (edgeX: number, edgeY: number) => horizontalCount + edgeY * (grid.width + 1) + edgeX;
  grid.pathEdges[horizontal(x, y)] = 1;
  grid.pathEdges[horizontal(x, y + 1)] = 1;
  grid.pathEdges[vertical(x, y)] = 1;
  grid.pathEdges[vertical(x + 1, y)] = 1;
  grid.configurations[cIndex(grid, x, y)] = [5186, -1];
}

test("classifyReachabilityEntity recognizes map gameplay roles", () => {
  assert.equal(classifyReachabilityEntity(entity("radiant_player_start_1", "info_player_start_goodguys", 0, 0)), "spawn");
  assert.equal(classifyReachabilityEntity(entity("radiant_t2_north", "npc_dota_tower", 0, 0)), "objective");
  assert.equal(classifyReachabilityEntity(entity("radiant_top_camp_hard", "npc_dota_neutral_spawner", 0, 0)), "camp");
  assert.equal(classifyReachabilityEntity(entity("radiant_top_camp_ancient", "info_target", 0, 0)), "camp");
  assert.equal(classifyReachabilityEntity(entity("radiant_base_gate_north", "info_target", 0, 0)), "entrance");
  assert.equal(classifyReachabilityEntity(entity("dragon_fow_1", "info_target", 0, 0)), "other");
});

test("a flat map connects spawns and objectives", () => {
  const report = analyzeTileGridReachability(flatGrid(), [
    entity("radiant_spawn", "info_target", 128, 128),
    entity("radiant_t1", "npc_dota_tower", 1152, 640),
  ]);

  assert.equal(report.regions.length, 1);
  assert.equal(report.reachableCellCount, 15);
  assert.equal(report.unreachableCellCount, 0);
  assert.equal(report.findings.length, 0);
});

test("a cliff barrier exposes an inaccessible objective and unreachable region", () => {
  const grid = flatGrid();
  addVerticalCliff(grid, 2);
  const report = analyzeTileGridReachability(grid, [
    entity("radiant_spawn", "info_target", 128, 384),
    entity("dragon_boss_spawn", "info_target", 1152, 384),
  ]);

  assert.equal(report.cliffCellCount, 3);
  assert.equal(report.regions.length, 2);
  assert.equal(report.unreachableCellCount, 6);
  assert.ok(report.findings.some((finding) => finding.code === "inaccessible-objective"));
});

test("a marked ramp reconnects both elevations", () => {
  const grid = flatGrid();
  addVerticalCliff(grid, 2);
  markRamp(grid, 2, 1);
  const report = analyzeTileGridReachability(grid, [
    entity("radiant_spawn", "info_target", 128, 384),
    entity("dragon_boss_spawn", "info_target", 1152, 384),
  ]);

  assert.equal(report.rampCellCount, 1);
  assert.equal(report.unreachableCellCount, 0);
  assert.equal(report.findings.some((finding) => finding.code === "inaccessible-objective"), false);
});

test("path segments crossing cliff cells are rejected unless a ramp opens them", () => {
  const blockedGrid = flatGrid();
  addVerticalCliff(blockedGrid, 2);
  const paths = [
    entity("path_test_1", "path_corner", 128, 384, "path_test_2"),
    entity("path_test_2", "path_corner", 1152, 384),
  ];
  const blocked = analyzeTileGridReachability(blockedGrid, paths);
  assert.ok(blocked.findings.some((finding) => finding.code === "blocked-path-segment"));

  markRamp(blockedGrid, 2, 1);
  const opened = analyzeTileGridReachability(blockedGrid, paths);
  assert.equal(opened.findings.some((finding) => finding.code === "blocked-path-segment"), false);
});

test("missing terrain recipes are grouped as holes and trap spawns", () => {
  const grid = flatGrid();
  grid.configurations[cIndex(grid, 0, 0)] = [];
  const report = analyzeTileGridReachability(grid, [
    entity("radiant_spawn", "info_target", 128, 128),
  ]);

  assert.equal(report.holeCellCount, 1);
  assert.ok(report.findings.some((finding) => finding.code === "terrain-hole"));
  assert.ok(report.findings.some((finding) => finding.code === "trapped-spawn"));
});
