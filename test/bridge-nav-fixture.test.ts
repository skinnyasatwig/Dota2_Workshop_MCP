import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessBridgeNavigationFixture,
  bridgeNavigationFixtureLayout,
  bridgeNavigationFixtureRoutesFromText,
  buildBridgeNavigationFixtureText,
  inspectBridgeNavigationFixture,
} from "../src/dota/bridge-nav-fixture.js";
import { EngineNavigationExecution } from "../src/dota/engine-nav-test.js";
import { parseMapNavSurfaces } from "../src/dota/map-nav-surface.js";
import { parseMapSolids } from "../src/dota/map-solid.js";
import { parseTileGrid } from "../src/dota/tilegrid.js";

function fixtureGrid(width = 16, height = 16): string {
  const vertexCount = (width + 1) * (height + 1);
  const cellCount = width * height;
  const edgeCount = width * (height + 1) + (width + 1) * height;
  const quoted = (values: readonly number[]) => values.map((value) => `"${value}"`).join(", ");
  return `<!-- dmx encoding keyvalues2 1 format vmap 35 -->
"root" "CMapRootElement"
{
  "world" "CMapWorld"
  {
    "id" "elementid" "00000000-0000-0000-0000-000000000001"
    "nodeID" "int" "1"
    "children" "element_array"
    [
      "CMapDotaTileGrid"
      {
        "id" "elementid" "00000000-0000-0000-0000-000000000002"
        "nodeID" "int" "2"
        "origin" "vector3" "${-(width * 256) / 2} ${-(height * 256) / 2} 0"
        "gridWidth" "int" "${width}"
        "gridHeight" "int" "${height}"
        "verticesHeight" "int_array" [ ${quoted(new Array(vertexCount).fill(0))} ]
        "verticesWater" "bool_array" [ ${quoted(new Array(vertexCount).fill(0))} ]
        "cellsTileSet" "int_array" [ ${quoted(new Array(cellCount).fill(0))} ]
        "cellsOrientation" "int_array" [ ${quoted(new Array(cellCount).fill(0))} ]
        "cellConfiguration" "int_array" [ ${quoted(new Array(cellCount).fill(0).flatMap(() => [2, 5292, -1]))} ]
        "edgesPath" "bool_array" [ ${quoted(new Array(edgeCount).fill(0))} ]
      }
    ]
  }
}`;
}

test("bridge fixture isolates checked navigation surfaces from relocated tile terrain", () => {
  const source = fixtureGrid();
  const originalGrid = parseTileGrid(source);
  const layout = bridgeNavigationFixtureLayout(originalGrid);
  const text = buildBridgeNavigationFixtureText(source);
  const relocatedGrid = parseTileGrid(text);
  assert.deepEqual(layout.center, [0, 0]);
  assert.equal(layout.groundZ, 128);
  assert.equal(layout.deckTopZ, 384);
  assert.deepEqual(layout.relocatedTerrainCenter, [32768, 32768]);
  assert.deepEqual(layout.routes.map((route) => route.name), [
    "bridge_nav_surface_crossing",
    "no_navigation_surface_control",
    "same_xy_height_alias",
  ]);
  const inspection = inspectBridgeNavigationFixture(text);
  assert.deepEqual(relocatedGrid.origin, [30720, 30720, 0]);
  assert.deepEqual(inspection.terrainCenter, [32768, 32768]);
  assert.deepEqual(inspection.navigationCenter, [0, 0]);
  assert.ok((inspection.terrainCenterDistance ?? 0) > 40000);
  assert.deepEqual(parseMapSolids(text), []);
  assert.deepEqual(inspection.solidNames, []);
  assert.deepEqual(parseMapNavSurfaces(text).map((surface) => surface.targetname).sort(), [
    "bridge_fixture_deck_walkable",
    "bridge_fixture_east_approach_walkable",
    "bridge_fixture_west_approach_walkable",
  ]);
  assert.deepEqual(bridgeNavigationFixtureRoutesFromText(text), layout.routes);
});

function check(overrides: Record<string, unknown> = {}) {
  return {
    from: [-1024, 0, 256] as [number, number, number],
    to: [1024, 0, 256] as [number, number, number],
    startTraversable: true,
    endTraversable: true,
    canFindPath: true,
    pathLength: 2048,
    passed: true,
    ...overrides,
  };
}

test("bridge fixture assessment distinguishes isolated crossing, no-surface control, and Z alias", () => {
  const execution: EngineNavigationExecution = {
    failures: [],
    results: [
      {
        name: "bridge_nav_surface_crossing",
        mode: "both",
        pointCount: 3,
        endpoint: check(),
        segments: [
          { ...check({ to: [0, 0, 384], pathLength: 1024 }), index: 1 },
          { ...check({ from: [0, 0, 384], pathLength: 1024 }), index: 2 },
        ],
        passed: true,
      },
      {
        name: "no_navigation_surface_control",
        mode: "both",
        pointCount: 2,
        endpoint: check({
          from: [-1024, 2048, 128],
          to: [1024, 2048, 128],
          startTraversable: false,
          endTraversable: false,
          canFindPath: false,
          pathLength: -1,
          passed: false,
        }),
        segments: [{ ...check({
          from: [-1024, 2048, 128],
          to: [1024, 2048, 128],
          startTraversable: false,
          endTraversable: false,
          canFindPath: false,
          pathLength: -1,
          passed: false,
        }), index: 1 }],
        passed: false,
      },
      {
        name: "same_xy_height_alias",
        mode: "both",
        pointCount: 2,
        endpoint: check({ from: [0, 0, 128], to: [0, 0, 384], pathLength: 0 }),
        segments: [{ ...check({ from: [0, 0, 128], to: [0, 0, 384], pathLength: 0 }), index: 1 }],
        passed: true,
      },
    ],
  };
  const assessment = assessBridgeNavigationFixture(execution);
  assert.equal(assessment.passed, true, assessment.issues.join("\n"));
  assert.equal(assessment.sameXyHeightAliased, true);

  execution.results[1].passed = true;
  execution.results[1].endpoint = check();
  execution.results[1].segments = [{ ...check(), index: 1 }];
  const failed = assessBridgeNavigationFixture(execution);
  assert.equal(failed.passed, false);
  assert.match(failed.issues.join("\n"), /control unexpectedly found navigation/i);
});
