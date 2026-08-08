import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTileGridReachability,
  classifyReachabilityEntity,
} from "../src/dota/map-reachability.js";
import { cIndex, TileGrid, vIndex } from "../src/dota/tilegrid.js";
import { ParsedMapEntity } from "../src/dota/vmap.js";
import { ParsedMapVolume } from "../src/dota/map-volume.js";
import { ParsedMapSolid } from "../src/dota/map-solid.js";
import { MapCollisionObstacle } from "../src/dota/map-collision.js";
import { expandDotaComponents } from "../src/dota/dota-components.js";

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

test("player-clip footprints participate in offline reachability", () => {
  const blocker: ParsedMapVolume = {
    targetname: "center_wall",
    classname: "func_brush",
    recipe: "playerClip",
    center: [640, 384, 256],
    size: [256, 768, 512],
    footprint: [[-128, -384], [128, -384], [128, 384], [-128, 384]],
    yaw: 0,
    material: "materials/tools/toolsplayerclip.vmat",
    blocking: true,
  };
  const report = analyzeTileGridReachability(
    flatGrid(),
    [
      entity("radiant_spawn", "info_target", 128, 384),
      entity("dragon_boss_spawn", "info_target", 1152, 384),
    ],
    { blockingVolumes: [blocker] },
  );

  assert.equal(report.cells.filter((cell) => cell.blockingVolume === blocker.targetname).length, 3);
  assert.equal(report.regions.length, 2);
  assert.ok(report.findings.some((finding) => finding.code === "inaccessible-objective"));
});

test("offline reachability follows a polygon blocker instead of its bounding box", () => {
  const blocker: ParsedMapVolume = {
    targetname: "diamond_blocker",
    classname: "func_brush",
    recipe: "playerClip",
    center: [640, 384, 256],
    size: [768, 768, 512],
    footprint: [[0, -384], [384, 0], [0, 384], [-384, 0]],
    yaw: 0,
    material: "materials/tools/toolsplayerclip.vmat",
    blocking: true,
  };
  const report = analyzeTileGridReachability(flatGrid(), [], { blockingVolumes: [blocker] });

  assert.equal(report.cells.filter((cell) => cell.blockingVolume === blocker.targetname).length, 5);
  assert.equal(report.volumeBlockedCellCount, 5);
});

test("offline reachability follows a concave solid instead of its bounding box", () => {
  const blocker: ParsedMapSolid = {
    targetname: "l_shaped_wall",
    center: [640, 384, 256],
    yaw: 0,
    material: "materials/dev/reflectivity_30.vmat",
    footprint: [
      [-384, -384], [384, -384], [384, -128],
      [-128, -128], [-128, 384], [-384, 384],
    ],
    height: 512,
    blocking: true,
  };
  const report = analyzeTileGridReachability(flatGrid(), [], { blockingVolumes: [blocker] });

  assert.equal(report.cells.filter((cell) => cell.blockingVolume === blocker.targetname).length, 5);
  assert.equal(report.cells.find((cell) => cell.x === 3 && cell.y === 2)?.blockingVolume, undefined);
});

test("elevated solid lintels leave offline standing clearance open", () => {
  const lintel: ParsedMapSolid = {
    targetname: "arch_lintel",
    center: [640, 384, 640],
    yaw: 0,
    material: "materials/dev/reflectivity_30.vmat",
    footprint: [[-384, -128], [384, -128], [384, 128], [-384, 128]],
    height: 256,
    blocking: true,
  };
  const open = analyzeTileGridReachability(flatGrid(), [], { blockingVolumes: [lintel] });
  assert.equal(open.agentHeight, 256);
  assert.equal(open.volumeBlockedCellCount, 0);

  const lowLintel = { ...lintel, center: [640, 384, 384] as [number, number, number] };
  const blocked = analyzeTileGridReachability(flatGrid(), [], { blockingVolumes: [lowLintel] });
  assert.equal(blocked.volumeBlockedCellCount, 3);
});

test("the checked arch recipe blocks its posts but leaves its opening reachable", () => {
  const expanded = expandDotaComponents([{
    kind: "arch",
    name: "test_arch",
    origin: [896, 640, 128],
    width: 1280,
    depth: 256,
    height: 768,
    openingWidth: 512,
    openingHeight: 512,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  const blockers: ParsedMapSolid[] = expanded.managedSolids.map((solid) => ({
    targetname: solid.targetname,
    center: solid.center,
    yaw: solid.yaw ?? 0,
    material: solid.material,
    footprint: solid.extrusion.points,
    height: solid.extrusion.height,
    blocking: true,
  }));
  const report = analyzeTileGridReachability(
    flatGrid(7, 5),
    [
      entity("radiant_spawn", "info_target", 896, 128),
      entity("dragon_boss_spawn", "info_target", 896, 1152),
    ],
    { blockingVolumes: blockers },
  );

  assert.equal(report.cells.find((cell) => cell.x === 3 && cell.y === 2)?.blockingVolume, undefined);
  assert.equal(report.cells.find((cell) => cell.x === 1 && cell.y === 2)?.blockingVolume, "test_arch_left_post");
  assert.equal(report.cells.find((cell) => cell.x === 5 && cell.y === 2)?.blockingVolume, "test_arch_right_post");
  assert.equal(report.findings.some((finding) => finding.code === "inaccessible-objective"), false);
});

test("the checked ring platform preserves its central opening offline", () => {
  const expanded = expandDotaComponents([{
    kind: "ringPlatform",
    name: "test_ring",
    center: [1152, 896, 128],
    outerRadius: 768,
    innerRadius: 384,
    height: 256,
    sides: 4,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  const blockers: ParsedMapSolid[] = expanded.managedSolids.map((solid) => ({
    targetname: solid.targetname,
    center: solid.center,
    yaw: solid.yaw ?? 0,
    material: solid.material,
    footprint: solid.extrusion.points,
    height: solid.extrusion.height,
    blocking: true,
  }));
  const report = analyzeTileGridReachability(
    flatGrid(9, 7),
    [entity("center_probe", "info_target", 1152, 896)],
    { blockingVolumes: blockers },
  );

  assert.equal(report.cells.find((cell) => cell.x === 4 && cell.y === 3)?.blockingVolume, undefined);
  assert.match(
    report.cells.find((cell) => cell.x === 6 && cell.y === 3)?.blockingVolume ?? "",
    /^test_ring_segment_\d+_deck$/,
  );
  assert.equal(report.cells.find((cell) => cell.x === 8 && cell.y === 3)?.blockingVolume, undefined);
});

test("the checked irregular holed platform preserves its opening offline", () => {
  const expanded = expandDotaComponents([{
    kind: "holedPlatform",
    name: "test_irregular_platform",
    center: [1152, 896, 128],
    outer: [[-700, -450], [450, -550], [760, 0], [400, 600], [-650, 500]],
    hole: [[-300, -180], [220, -260], [340, 20], [170, 280], [-260, 220]],
    height: 256,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  const blockers: ParsedMapSolid[] = expanded.managedSolids.map((solid) => ({
    targetname: solid.targetname,
    center: solid.center,
    yaw: solid.yaw ?? 0,
    material: solid.material,
    footprint: solid.extrusion.points,
    height: solid.extrusion.height,
    blocking: true,
  }));
  const report = analyzeTileGridReachability(
    flatGrid(9, 7),
    [entity("center_probe", "info_target", 1152, 896)],
    { blockingVolumes: blockers },
  );

  assert.equal(report.cells.find((cell) => cell.x === 4 && cell.y === 3)?.blockingVolume, undefined);
  assert.match(
    report.cells.find((cell) => cell.x === 6 && cell.y === 3)?.blockingVolume ?? "",
    /^test_irregular_platform_segment_\d+_deck$/,
  );
  assert.equal(report.cells.find((cell) => cell.x === 8 && cell.y === 3)?.blockingVolume, undefined);
});

test("creep routes warn when they cross explicit Valve obstruction classes", () => {
  const report = analyzeTileGridReachability(flatGrid(), [
    entity("path_test_1", "path_corner", 128, 384, "path_test_2"),
    entity("path_test_2", "path_corner", 1152, 384),
    entity("tree_on_route", "ent_dota_tree", 640, 384),
    entity("solid_prop_unknown", "prop_static", 896, 384),
  ]);

  assert.equal(report.collisionObstacleCount, 2);
  assert.equal(report.approximatedCollisionObstacleCount, 1);
  assert.equal(report.unknownBoundsCollisionObstacleCount, 1);
  const warning = report.findings.find((finding) => finding.code === "path-collision-obstacle");
  assert.equal(warning?.severity, "warn");
  assert.match(warning?.detail ?? "", /tree_on_route/);
  assert.doesNotMatch(warning?.detail ?? "", /solid_prop_unknown/);
});

test("resolved PHYS bounds conservatively block covered terrain cells and route segments", () => {
  const obstacle: MapCollisionObstacle = {
    id: "physical_prop",
    sourceIndex: 0,
    targetname: "physical_prop",
    classname: "prop_static",
    origin: [640, 384, 128],
    kind: "solid-prop",
    confidence: "physical-model-bounds",
    model: "models/props/test.vmdl",
    physicalFootprints: [
      {
        points: [[512, 256], [768, 256], [768, 512], [512, 512]],
        minZ: 100,
        maxZ: 200,
        localBounds: { min: [-128, -128, -28], max: [128, 128, 72] },
        projection: "curved-primitive",
      },
      {
        points: [[512, 256], [768, 256], [768, 512], [512, 512]],
        minZ: 100,
        maxZ: 200,
        localBounds: { min: [-128, -128, -28], max: [128, 128, 72] },
        projection: "bounds",
      },
    ],
    reason: "test PHYS bounds",
  };
  const report = analyzeTileGridReachability(
    flatGrid(),
    [
      entity("path_test_1", "path_corner", 128, 384, "path_test_2"),
      entity("path_test_2", "path_corner", 1152, 384),
    ],
    { collisionObstacles: [obstacle] },
  );

  assert.equal(report.physicalBoundsCollisionObstacleCount, 1);
  assert.equal(report.exactHullProjectionCount, 0);
  assert.equal(report.meshVertexHullProjectionCount, 0);
  assert.equal(report.curvedPrimitiveProjectionCount, 1);
  assert.equal(report.boundsProjectionCount, 1);
  assert.equal(report.modelCollisionBlockedCellCount, 1);
  assert.equal(report.cells.find((cell) => cell.x === 2 && cell.y === 1)?.collisionObstacle, "physical_prop");
  assert.ok(report.findings.some((finding) => finding.code === "blocked-path-segment"));
  assert.ok(report.findings.some((finding) => finding.code === "path-collision-obstacle"));
});
