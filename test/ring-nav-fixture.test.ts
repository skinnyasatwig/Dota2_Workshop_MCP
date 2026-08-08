import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineNavigationExecution } from "../src/dota/engine-nav-test.js";
import { parseMapNavSurfaces } from "../src/dota/map-nav-surface.js";
import { parseMapSolids } from "../src/dota/map-solid.js";
import {
  assessRingNavigationFixture,
  buildRingNavigationFixtureText,
  inspectRingNavigationFixture,
  ringNavigationFixtureLayout,
  ringNavigationFixtureRoutesFromText,
} from "../src/dota/ring-nav-fixture.js";
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

test("ring fixture isolates eight navigation wedges and preserves a central opening", () => {
  const source = fixtureGrid();
  const layout = ringNavigationFixtureLayout(parseTileGrid(source));
  const text = buildRingNavigationFixtureText(source);
  assert.deepEqual(layout.center, [0, 0]);
  assert.equal(layout.deckTopZ, 384);
  assert.equal(layout.innerRadius, 768);
  assert.equal(layout.outerRadius, 1536);
  assert.deepEqual(layout.relocatedTerrainCenter, [32768, 32768]);
  assert.deepEqual(layout.routes.map((route) => route.name), [
    "ring_navigation_arc",
    "ring_center_hole_control",
    "ring_outer_void_control",
  ]);
  const inspection = inspectRingNavigationFixture(text);
  assert.deepEqual(inspection.terrainCenter, [32768, 32768]);
  assert.deepEqual(inspection.navigationCenter, [0, 0]);
  assert.ok((inspection.terrainCenterDistance ?? 0) > 40000);
  assert.deepEqual(parseMapSolids(text), []);
  assert.equal(parseMapNavSurfaces(text).length, 8);
  assert.deepEqual(inspection.navigationSurfaceNames, Array.from(
    { length: 8 },
    (_unused, index) => `ring_fixture_segment_${String(index + 1).padStart(2, "0")}_walkable`,
  ));
  assert.deepEqual(ringNavigationFixtureRoutesFromText(text), layout.routes);
});

function check(overrides: Record<string, unknown> = {}) {
  return {
    from: [-1152, 0, 384] as [number, number, number],
    to: [1152, 0, 384] as [number, number, number],
    startTraversable: true,
    endTraversable: true,
    canFindPath: true,
    pathLength: 3619,
    passed: true,
    ...overrides,
  };
}

function voidControl(name: string, from: [number, number, number]) {
  const result = check({
    from,
    startTraversable: false,
    canFindPath: false,
    pathLength: -1,
    passed: false,
  });
  return {
    name,
    mode: "both" as const,
    pointCount: 2,
    endpoint: result,
    segments: [{ ...result, index: 1 }],
    passed: false,
  };
}

test("ring fixture assessment distinguishes connected seams from center and outer voids", () => {
  const execution: EngineNavigationExecution = {
    failures: [],
    results: [
      {
        name: "ring_navigation_arc",
        mode: "both",
        pointCount: 5,
        endpoint: check(),
        segments: [1, 2, 3, 4].map((index) => ({ ...check({ pathLength: 904 }), index })),
        passed: true,
      },
      voidControl("ring_center_hole_control", [0, 0, 384]),
      voidControl("ring_outer_void_control", [2304, 0, 384]),
    ],
  };
  const assessment = assessRingNavigationFixture(execution);
  assert.equal(assessment.passed, true, assessment.issues.join("\n"));

  execution.results[1].passed = true;
  execution.results[1].endpoint = check();
  execution.results[1].segments = [{ ...check(), index: 1 }];
  const failed = assessRingNavigationFixture(execution);
  assert.equal(failed.passed, false);
  assert.match(failed.issues.join("\n"), /center-hole control unexpectedly found navigation/i);
});
