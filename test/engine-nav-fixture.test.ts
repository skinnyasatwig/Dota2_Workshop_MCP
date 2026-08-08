import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGINE_NAV_FIXTURE_ROUTES,
  assessEngineNavigationFixture,
} from "../src/dota/engine-nav-fixture.js";
import { EngineNavigationExecution } from "../src/dota/engine-nav-test.js";

function check(overrides: Record<string, unknown> = {}) {
  return {
    from: [-384, 0, 128] as [number, number, number],
    to: [384, 0, 128] as [number, number, number],
    startTraversable: true,
    endTraversable: true,
    canFindPath: true,
    pathLength: 768,
    passed: true,
    ...overrides,
  };
}

function successfulFixtureExecution(): EngineNavigationExecution {
  return {
    failures: [],
    results: [
      {
        name: "fixture_open_route",
        mode: "both",
        pointCount: 2,
        endpoint: check(),
        segments: [{ ...check(), index: 1 }],
        passed: true,
      },
      {
        name: "fixture_blocked_start",
        mode: "both",
        pointCount: 2,
        endpoint: check({
          from: [0, 384, 128],
          to: [384, 384, 128],
          startTraversable: true,
          canFindPath: false,
          pathLength: -1,
          passed: false,
          nearestStart: { point: [-32, 480, 128], gridOffset: [-1, 1], distance: 101.19288512539 },
        }),
        segments: [check({
          index: 1,
          from: [0, 384, 128],
          to: [384, 384, 128],
          startTraversable: true,
          canFindPath: false,
          pathLength: -1,
          passed: false,
          nearestStart: { point: [-32, 480, 128], gridOffset: [-1, 1], distance: 101.19288512539 },
        })],
        passed: false,
      },
    ],
  };
}

test("engine navigation fixture owns one positive and one negative route", () => {
  assert.deepEqual(ENGINE_NAV_FIXTURE_ROUTES.map((route) => route.name), [
    "fixture_open_route",
    "fixture_blocked_start",
  ]);
  const assessment = assessEngineNavigationFixture(successfulFixtureExecution(), {
    blockedOriginalPoint: [0, 384, 128],
    blockedSuggestedPoint: [-32, 480, 128],
    blockedGridOffset: [-1, 1],
  });
  assert.equal(assessment.passed, true, assessment.issues.join("\n"));
  assert.equal(assessment.repairSuggestions.length, 1);
});

test("engine navigation fixture rejects a missing blocker or changed repair", () => {
  const execution = successfulFixtureExecution();
  execution.results[0].endpoint!.pathLength = 640;
  const blocked = execution.results[1];
  blocked.passed = true;
  blocked.endpoint = check({ from: [0, 384, 128], to: [384, 384, 128] });
  blocked.segments = [{ ...check({ from: [0, 384, 128], to: [384, 384, 128] }), index: 1 }];

  const assessment = assessEngineNavigationFixture(execution, {
    blockedOriginalPoint: [0, 384, 128],
    blockedSuggestedPoint: [-32, 480, 128],
    blockedGridOffset: [-1, 1],
  });
  assert.equal(assessment.passed, false);
  assert.match(assessment.issues.join("\n"), /path length changed/i);
  assert.match(assessment.issues.join("\n"), /unexpectedly passed/i);
  assert.match(assessment.issues.join("\n"), /disconnect/i);
  assert.match(assessment.issues.join("\n"), /nearby repair/i);
});
