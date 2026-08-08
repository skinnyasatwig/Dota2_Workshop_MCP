import { expandDotaComponents } from "./dota-components.js";
import { DEBUG_SDK_VERSION } from "./debugsdk.js";
import {
  EngineNavigationExecution,
  EngineNavigationRoute,
  EngineNavigationRouteResult,
} from "./engine-nav-test.js";
import { relocateTileGridForIsolatedNavigation } from "./isolated-navigation-fixture.js";
import { parseMapNavSurfaces, reconcileMapNavSurfaces } from "./map-nav-surface.js";
import { parseMapSolids } from "./map-solid.js";
import { parseTileGrid, TileGrid } from "./tilegrid.js";
import { buildEntityBlock, insertEntity, maxNodeId } from "./vmap.js";

export const RING_NAV_FIXTURE_MAP = "ring_nav_fixture";
export const RING_NAV_FIXTURE_DEBUG_SDK_VERSION = DEBUG_SDK_VERSION;

export interface RingNavigationFixtureLayout {
  center: [number, number];
  deckTopZ: number;
  innerRadius: number;
  outerRadius: number;
  middleRadius: number;
  relocatedTerrainCenter: [number, number];
  routes: EngineNavigationRoute[];
}

function rounded(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}

function ringFixtureRoutes(
  center: [number, number],
  deckTopZ: number,
  middleRadius: number,
  outerRadius: number,
): EngineNavigationRoute[] {
  const point = (degrees: number): [number, number, number] => {
    const radians = (degrees * Math.PI) / 180;
    return [
      rounded(center[0] + Math.cos(radians) * middleRadius),
      rounded(center[1] + Math.sin(radians) * middleRadius),
      deckTopZ,
    ];
  };
  return [
    {
      name: "ring_navigation_arc",
      points: [point(180), point(135), point(90), point(45), point(0)],
    },
    {
      name: "ring_center_hole_control",
      points: [[center[0], center[1], deckTopZ], point(0)],
    },
    {
      name: "ring_outer_void_control",
      points: [[center[0] + outerRadius + 768, center[1], deckTopZ], point(0)],
    },
  ];
}

/** Derive an isolated regular-ring fixture from Valve's blank tile grid. */
export function ringNavigationFixtureLayout(grid: TileGrid): RingNavigationFixtureLayout {
  if (grid.width < 16 || grid.height < 16) {
    throw new Error("The ring navigation fixture needs at least a 16 by 16 tile grid.");
  }
  const center: [number, number] = [
    grid.origin[0] + (grid.width * grid.tileSize) / 2,
    grid.origin[1] + (grid.height * grid.tileSize) / 2,
  ];
  const deckTopZ = grid.origin[2] + 128 + 256;
  const innerRadius = 768;
  const outerRadius = 1536;
  const middleRadius = (innerRadius + outerRadius) / 2;
  return {
    center,
    deckTopZ,
    innerRadius,
    outerRadius,
    middleRadius,
    relocatedTerrainCenter: [center[0] + 32768, center[1] + 32768],
    routes: ringFixtureRoutes(center, deckTopZ, middleRadius, outerRadius),
  };
}

/**
 * Build a causal ring-navigation fixture. Tile terrain is relocated and visible solids are omitted,
 * so only the eight dedicated Valve navigation wedges can connect the arc or define its hole.
 */
export function buildRingNavigationFixtureText(baseText: string): string {
  const grid = parseTileGrid(baseText);
  const layout = ringNavigationFixtureLayout(grid);
  let text = relocateTileGridForIsolatedNavigation(baseText);
  let nodeId = maxNodeId(text) + 1;
  text = insertEntity(text, buildEntityBlock({
    classname: "info_player_start_goodguys",
    origin: `${layout.center[0] - layout.middleRadius} ${layout.center[1]} ${layout.deckTopZ}`,
    properties: { targetname: "ring_fixture_radiant_start" },
  }, nodeId++));
  text = insertEntity(text, buildEntityBlock({
    classname: "info_player_start_badguys",
    origin: `${layout.center[0] + layout.middleRadius} ${layout.center[1]} ${layout.deckTopZ}`,
    angles: "0 180 0",
    properties: { targetname: "ring_fixture_dire_start" },
  }, nodeId++));

  const structures = expandDotaComponents([{
    kind: "ringPlatform",
    name: "ring_fixture",
    center: [layout.center[0], layout.center[1], layout.deckTopZ - 32],
    yaw: 22.5,
    outerRadius: layout.outerRadius,
    innerRadius: layout.innerRadius,
    height: 64,
    sides: 8,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  return reconcileMapNavSurfaces(text, structures.managedNavSurfaces).text;
}

export interface RingNavigationFixtureInspection {
  terrainCenter: [number, number];
  navigationCenter?: [number, number];
  terrainCenterDistance?: number;
  solidNames: string[];
  navigationSurfaceNames: string[];
}

export function inspectRingNavigationFixture(text: string): RingNavigationFixtureInspection {
  const grid = parseTileGrid(text);
  const terrainCenter: [number, number] = [
    grid.origin[0] + (grid.width * grid.tileSize) / 2,
    grid.origin[1] + (grid.height * grid.tileSize) / 2,
  ];
  const navigationSurfaces = parseMapNavSurfaces(text);
  const first = navigationSurfaces.find((surface) => surface.targetname === "ring_fixture_segment_01_walkable");
  const navigationCenter = first ? [first.center[0], first.center[1]] as [number, number] : undefined;
  return {
    terrainCenter,
    navigationCenter,
    terrainCenterDistance: navigationCenter
      ? Math.hypot(terrainCenter[0] - navigationCenter[0], terrainCenter[1] - navigationCenter[1])
      : undefined,
    solidNames: parseMapSolids(text).map((solid) => solid.targetname).sort(),
    navigationSurfaceNames: navigationSurfaces.map((surface) => surface.targetname).sort(),
  };
}

/** Recover route coordinates from converted ring geometry, independent of relocated tile terrain. */
export function ringNavigationFixtureRoutesFromText(text: string): EngineNavigationRoute[] {
  const surfaces = parseMapNavSurfaces(text).filter((surface) =>
    /^ring_fixture_segment_\d+_walkable$/.test(surface.targetname));
  const first = surfaces.find((surface) => surface.targetname === "ring_fixture_segment_01_walkable");
  if (!first || first.height === undefined || surfaces.length !== 8) {
    throw new Error("The ring fixture does not contain its expected eight flat navigation wedges.");
  }
  const radii = first.footprint.map(([x, y]) => Math.hypot(x, y));
  const innerRadius = rounded(Math.min(...radii));
  const outerRadius = rounded(Math.max(...radii));
  const center: [number, number] = [first.center[0], first.center[1]];
  const deckTopZ = first.center[2] + first.height / 2;
  return ringFixtureRoutes(center, deckTopZ, (innerRadius + outerRadius) / 2, outerRadius);
}

export interface RingNavigationFixtureAssessment {
  passed: boolean;
  issues: string[];
}

function assessVoidControl(
  result: EngineNavigationRouteResult | undefined,
  name: string,
  issues: string[],
): void {
  if (!result) {
    issues.push(`The ${name} result is missing.`);
    return;
  }
  const checks = [result.endpoint, ...result.segments].filter((check) => check !== null);
  if (result.passed) issues.push(`The ${name} unexpectedly found navigation through empty space.`);
  if (checks.some((check) =>
    check.startTraversable || !check.endTraversable || check.canFindPath || check.pathLength !== -1 || check.passed)) {
    issues.push(`The ${name} did not preserve a non-traversable start, traversable ring endpoint, and failed path.`);
  }
}

/** Assert connected wedge seams plus causal center-hole and outer-void controls. */
export function assessRingNavigationFixture(
  execution: EngineNavigationExecution,
): RingNavigationFixtureAssessment {
  const issues = execution.failures.map((failure) => `${failure.name}: ${failure.error}`);
  const arc = execution.results.find((result) => result.name === "ring_navigation_arc");
  if (!arc) issues.push("The ring navigation arc result is missing.");
  else {
    if (!arc.passed) issues.push("The isolated ring navigation wedges did not connect across their seams.");
    if (arc.pointCount !== 5 || arc.segments.length !== 4 || !arc.endpoint) {
      issues.push("The ring arc did not return its expected five-point endpoint-and-segment result.");
    }
    const checks = [arc.endpoint, ...arc.segments].filter((check) => check !== null);
    if (checks.some((check) =>
      !check.startTraversable || !check.endTraversable || !check.canFindPath || check.pathLength <= 0)) {
      issues.push("One or more ring arc checks were not positively traversable with a nonzero path.");
    }
  }
  assessVoidControl(
    execution.results.find((result) => result.name === "ring_center_hole_control"),
    "ring center-hole control",
    issues,
  );
  assessVoidControl(
    execution.results.find((result) => result.name === "ring_outer_void_control"),
    "ring outer-void control",
    issues,
  );
  return { passed: issues.length === 0, issues };
}
