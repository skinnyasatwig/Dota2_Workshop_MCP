import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEngineNavigationCommand,
  engineNavigationRoutesFromManagedPaths,
  parseEngineNavigationLine,
  validateEngineNavigationRoutes,
} from "../src/dota/engine-nav-test.js";

test("managed paths become bounded engine navigation routes", () => {
  const routes = engineNavigationRoutesFromManagedPaths([
    {
      name: "radiant_north",
      points: [
        [-1024, 256, 128],
        [0, 256, 128],
        [1024, 256, 128],
      ],
    },
  ]);
  assert.deepEqual(routes[0].points[1], [0, 256, 128]);
  const command = buildEngineNavigationCommand(routes[0], "both");
  assert.match(command, /^mcp_eval "/);
  assert.match(command, /GridNav:CanFindPath/);
  assert.match(command, /GridNav:FindPathLength/);
  assert.match(command, /GridNav:IsTraversable/);
  assert.match(command, /radiant_north/);
});

test("route validation rejects duplicates, unsafe names, and oversized routes", () => {
  assert.throws(
    () =>
      validateEngineNavigationRoutes([
        { name: "same", points: [[0, 0, 0], [1, 0, 0]] },
        { name: "same", points: [[0, 1, 0], [1, 1, 0]] },
      ]),
    /duplicated/,
  );
  assert.throws(
    () => validateEngineNavigationRoutes([{ name: "bad name", points: [[0, 0, 0], [1, 0, 0]] }]),
    /may contain only/,
  );
  assert.throws(
    () =>
      validateEngineNavigationRoutes([
        {
          name: "too_long",
          points: Array.from({ length: 129 }, (_, index) => [index, 0, 0] as [number, number, number]),
        },
      ]),
    /more than 128 points/,
  );
});

test("structured DebugSDK navigation output is parsed strictly", () => {
  const payload = {
    name: "radiant_north",
    mode: "both",
    pointCount: 2,
    endpoint: {
      from: [-512, 256, 128],
      to: [512, 256, 128],
      startTraversable: true,
      endTraversable: true,
      canFindPath: true,
      pathLength: 1024,
      passed: true,
    },
    segments: [
      {
        index: 1,
        from: [-512, 256, 128],
        to: [512, 256, 128],
        startTraversable: true,
        endTraversable: true,
        canFindPath: true,
        pathLength: 1024,
        passed: true,
      },
    ],
    passed: true,
  };
  const parsed = parseEngineNavigationLine(`[MCP] EVAL_OK ${JSON.stringify(payload)}`);
  assert.equal(parsed.passed, true);
  assert.equal(parsed.segments[0].pathLength, 1024);
  assert.throws(() => parseEngineNavigationLine("[MCP] EVAL_OK {}"), /wrong shape/);
});
