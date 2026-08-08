import { expandDotaComponents } from "./dota-components.js";
import {
  EngineNavigationExecution,
  EngineNavigationRoute,
} from "./engine-nav-test.js";
import { parseMapNavSurfaces, reconcileMapNavSurfaces } from "./map-nav-surface.js";
import { parseMapSolids } from "./map-solid.js";
import { parseTileGrid, TileGrid } from "./tilegrid.js";
import { buildEntityBlock, insertEntity, maxNodeId } from "./vmap.js";
import { relocateTileGridForIsolatedNavigation } from "./isolated-navigation-fixture.js";

export const BRIDGE_NAV_FIXTURE_MAP = "bridge_nav_fixture";
export const BRIDGE_NAV_FIXTURE_DEBUG_SDK_VERSION = "1.7.0";

export interface BridgeNavigationFixtureLayout {
  center: [number, number];
  groundZ: number;
  deckTopZ: number;
  relocatedTerrainCenter: [number, number];
  routes: EngineNavigationRoute[];
}

function bridgeFixtureRoutes(
  center: [number, number],
  groundZ: number,
  deckTopZ: number,
): EngineNavigationRoute[] {
  return [
    {
      name: "bridge_nav_surface_crossing",
      points: [
        [center[0] - 1024, center[1], groundZ + 128],
        [center[0], center[1], deckTopZ],
        [center[0] + 1024, center[1], groundZ + 128],
      ],
    },
    {
      name: "no_navigation_surface_control",
      points: [
        [center[0] - 1024, center[1] + 2048, groundZ],
        [center[0] + 1024, center[1] + 2048, groundZ],
      ],
    },
    {
      name: "same_xy_height_alias",
      points: [
        [center[0], center[1], groundZ],
        [center[0], center[1], deckTopZ],
      ],
    },
  ];
}

/** Derive a centered, scale-stable bridge fixture from Valve's blank tile grid. */
export function bridgeNavigationFixtureLayout(grid: TileGrid): BridgeNavigationFixtureLayout {
  if (grid.width < 16 || grid.height < 16) {
    throw new Error("The bridge navigation fixture needs at least a 16 by 16 tile grid.");
  }
  const center: [number, number] = [
    grid.origin[0] + (grid.width * grid.tileSize) / 2,
    grid.origin[1] + (grid.height * grid.tileSize) / 2,
  ];
  const groundZ = grid.origin[2] + 128;
  const deckTopZ = groundZ + 256;
  const relocatedTerrainCenter: [number, number] = [center[0] + 32768, center[1] + 32768];
  return {
    center,
    groundZ,
    deckTopZ,
    relocatedTerrainCenter,
    routes: bridgeFixtureRoutes(center, groundZ, deckTopZ),
  };
}

/**
 * Build a disposable causal navigation-surface fixture. Valve's tile terrain is relocated far away,
 * leaving only the three dedicated navigation meshes at the test coordinates. A nearby route with no
 * surface is therefore a real negative control rather than a second path over hidden terrain.
 */
export function buildBridgeNavigationFixtureText(baseText: string): string {
  const grid = parseTileGrid(baseText);
  const layout = bridgeNavigationFixtureLayout(grid);
  let text = relocateTileGridForIsolatedNavigation(baseText);
  let nodeId = maxNodeId(text) + 1;
  text = insertEntity(text, buildEntityBlock({
    classname: "info_player_start_goodguys",
    origin: `${layout.center[0] - 1024} ${layout.center[1]} ${layout.groundZ + 128}`,
    properties: { targetname: "bridge_fixture_radiant_start" },
  }, nodeId++));
  text = insertEntity(text, buildEntityBlock({
    classname: "info_player_start_badguys",
    origin: `${layout.center[0] + 1024} ${layout.center[1]} ${layout.groundZ + 128}`,
    angles: "0 180 0",
    properties: { targetname: "bridge_fixture_dire_start" },
  }, nodeId++));

  const material = "materials/dev/reflectivity_30.vmat";
  const width = 512;
  const thickness = 64;
  const structures = expandDotaComponents([
    {
      kind: "bridgeApproach",
      name: "bridge_fixture_west_approach",
      start: [layout.center[0] - 1536, layout.center[1], layout.groundZ],
      end: [layout.center[0] - 512, layout.center[1], layout.deckTopZ],
      width,
      thickness,
      material,
    },
    {
      kind: "bridge",
      name: "bridge_fixture_deck",
      center: [layout.center[0], layout.center[1], layout.deckTopZ - thickness / 2],
      yaw: 0,
      length: 1024,
      width,
      thickness,
      material,
    },
    {
      kind: "bridgeApproach",
      name: "bridge_fixture_east_approach",
      start: [layout.center[0] + 512, layout.center[1], layout.deckTopZ],
      end: [layout.center[0] + 1536, layout.center[1], layout.groundZ],
      width,
      thickness,
      material,
    },
  ]);
  // Omit visible func_brush decks here: they might contribute their own navigation and would make
  // the dedicated Valve material impossible to test causally.
  return reconcileMapNavSurfaces(text, structures.managedNavSurfaces).text;
}

export interface BridgeNavigationFixtureInspection {
  terrainCenter: [number, number];
  navigationCenter?: [number, number];
  terrainCenterDistance?: number;
  solidNames: string[];
  navigationSurfaceNames: string[];
}

export function inspectBridgeNavigationFixture(text: string): BridgeNavigationFixtureInspection {
  const grid = parseTileGrid(text);
  const terrainCenter: [number, number] = [
    grid.origin[0] + (grid.width * grid.tileSize) / 2,
    grid.origin[1] + (grid.height * grid.tileSize) / 2,
  ];
  const navigationSurfaces = parseMapNavSurfaces(text);
  const deck = navigationSurfaces.find((surface) =>
    surface.targetname === "bridge_fixture_deck_walkable");
  const navigationCenter = deck ? [deck.center[0], deck.center[1]] as [number, number] : undefined;
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

/** Recover route coordinates from the converted deck, independent of the relocated tile terrain. */
export function bridgeNavigationFixtureRoutesFromText(text: string): EngineNavigationRoute[] {
  const deck = parseMapNavSurfaces(text).find((surface) =>
    surface.targetname === "bridge_fixture_deck_walkable");
  if (!deck || deck.height === undefined) {
    throw new Error("The bridge fixture deck is missing or unexpectedly sloped.");
  }
  const deckTopZ = deck.center[2] + deck.height / 2;
  return bridgeFixtureRoutes([deck.center[0], deck.center[1]], deckTopZ - 256, deckTopZ);
}

export interface BridgeNavigationFixtureAssessment {
  passed: boolean;
  issues: string[];
  sameXyHeightAliased: boolean;
}

/** Assert isolated surface crossing, an empty-space control, and Dota's X/Y-only height alias. */
export function assessBridgeNavigationFixture(
  execution: EngineNavigationExecution,
): BridgeNavigationFixtureAssessment {
  const issues = execution.failures.map((failure) => `${failure.name}: ${failure.error}`);
  const crossing = execution.results.find((result) => result.name === "bridge_nav_surface_crossing");
  if (!crossing) issues.push("The bridge crossing result is missing.");
  else {
    if (!crossing.passed) issues.push("The isolated Valve navigation surfaces did not connect across the bridge.");
    if (crossing.pointCount !== 3 || crossing.segments.length !== 2 || !crossing.endpoint) {
      issues.push("The bridge crossing did not return the expected three-point endpoint-and-segment result.");
    }
    const checks = [crossing.endpoint, ...crossing.segments].filter((check) => check !== null);
    if (checks.some((check) =>
      !check.startTraversable || !check.endTraversable || !check.canFindPath || check.pathLength <= 0)) {
      issues.push("One or more bridge crossing checks were not positively traversable with a nonzero path.");
    }
  }

  const control = execution.results.find((result) => result.name === "no_navigation_surface_control");
  if (!control) issues.push("The no-surface control result is missing.");
  else {
    const checks = [control.endpoint, ...control.segments].filter((check) => check !== null);
    if (control.passed) issues.push("The no-surface control unexpectedly found navigation outside the relocated terrain.");
    if (checks.some((check) => check.canFindPath || check.pathLength !== -1 || check.passed)) {
      issues.push("The no-surface control no longer returns a failed path with length -1.");
    }
    if (checks.some((check) => check.startTraversable || check.endTraversable)) {
      issues.push("A no-surface control endpoint unexpectedly reports as traversable.");
    }
  }

  const alias = execution.results.find((result) => result.name === "same_xy_height_alias");
  const aliasChecks = alias
    ? [alias.endpoint, ...alias.segments].filter((check) => check !== null)
    : [];
  const sameXyHeightAliased = !!alias && alias.passed && aliasChecks.length > 0 &&
    aliasChecks.every((check) =>
      check.startTraversable && check.endTraversable && check.canFindPath && check.pathLength === 0);
  if (!alias) issues.push("The same-X/Y height-alias result is missing.");
  else if (!sameXyHeightAliased) {
    issues.push("The engine no longer aliases same-X/Y probes across Z as the two-dimensional GridNav API predicts.");
  }

  return { passed: issues.length === 0, issues, sameXyHeightAliased };
}
