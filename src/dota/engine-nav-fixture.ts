import {
  EngineNavigationExecution,
  EngineNavigationPoint,
  EngineNavigationRepairSuggestion,
  EngineNavigationRoute,
  engineNavigationRepairSuggestions,
} from "./engine-nav-test.js";
import { DEBUG_SDK_VERSION } from "./debugsdk.js";

export const ENGINE_NAV_FIXTURE_MAP = "engine_nav_fixture";
export const ENGINE_NAV_FIXTURE_DEBUG_SDK_VERSION = DEBUG_SDK_VERSION;

/**
 * A deliberately tiny real-engine acceptance case.
 *
 * The open route crosses Valve's blank-map floor. The blocked route starts at
 * the repository-owned point_simple_obstruction inserted by compile-fixture.ts.
 * Keeping both assertions on one disposable map gives us positive and negative
 * GridNav evidence without launching Hammer or modifying a user project.
 */
export const ENGINE_NAV_FIXTURE_ROUTES: readonly EngineNavigationRoute[] = [
  {
    name: "fixture_open_route",
    points: [
      [-384, 0, 128],
      [384, 0, 128],
    ],
  },
  {
    name: "fixture_blocked_start",
    points: [
      [0, 384, 128],
      [384, 384, 128],
    ],
  },
];

export interface EngineNavigationFixtureExpectation {
  blockedOriginalPoint: EngineNavigationPoint;
  blockedSuggestedPoint?: EngineNavigationPoint;
  blockedGridOffset?: [number, number];
}

export interface EngineNavigationFixtureAssessment {
  passed: boolean;
  issues: string[];
  repairSuggestions: EngineNavigationRepairSuggestion[];
}

/**
 * Assert the semantic result rather than merely accepting a successful command:
 * one route must work, one route must be disconnected, and the repair must be
 * stable when the caller supplies the engine-proven expected coordinates.
 */
export function assessEngineNavigationFixture(
  execution: EngineNavigationExecution,
  expectation: EngineNavigationFixtureExpectation,
): EngineNavigationFixtureAssessment {
  const issues: string[] = [];
  if (execution.failures.length) {
    issues.push(...execution.failures.map((failure) => `${failure.name}: ${failure.error}`));
  }

  const open = execution.results.find((result) => result.name === "fixture_open_route");
  if (!open) issues.push("The open-route result is missing.");
  else {
    if (!open.passed) issues.push("The known-open route did not pass GridNav.");
    if (open.mode !== "both" || open.pointCount !== 2) {
      issues.push("The open route did not return the expected two-point endpoint-and-segment result.");
    }
    if (!open.endpoint?.passed || open.endpoint.pathLength !== 768) {
      issues.push(`The open endpoint path length changed from 768 to ${open.endpoint?.pathLength ?? "missing"}.`);
    }
    if (open.segments.length !== 1 || !open.segments[0]?.passed || open.segments[0].pathLength !== 768) {
      issues.push(`The open segment path length changed from 768 to ${open.segments[0]?.pathLength ?? "missing"}.`);
    }
  }

  const blocked = execution.results.find((result) => result.name === "fixture_blocked_start");
  if (!blocked) {
    issues.push("The deliberately blocked-route result is missing.");
  } else {
    const checks = [blocked.endpoint, ...blocked.segments].filter((check) => check !== null);
    const disconnectedFromExpectedStart = checks.some((check) =>
      check.from.every((value, index) => value === expectation.blockedOriginalPoint[index]) &&
      !check.canFindPath
    );
    if (blocked.passed) issues.push("The deliberately blocked route unexpectedly passed GridNav.");
    if (blocked.mode !== "both" || blocked.pointCount !== 2 || blocked.segments.length !== 1 || !blocked.endpoint) {
      issues.push("The disconnected route did not return the expected two-point endpoint-and-segment result.");
    }
    if (checks.some((check) => !check.startTraversable || !check.endTraversable)) {
      issues.push("The disconnected fixture endpoints are no longer individually traversable.");
    }
    if (checks.some((check) => check.canFindPath || check.pathLength !== -1 || check.passed)) {
      issues.push("The disconnected fixture no longer returns the expected failed path with length -1.");
    }
    if (!disconnectedFromExpectedStart) {
      issues.push("The fixture obstruction did not disconnect the expected route start from its destination.");
    }
  }

  const repairSuggestions = engineNavigationRepairSuggestions(execution.results);
  const repair = repairSuggestions.find((suggestion) =>
    suggestion.routeName === "fixture_blocked_start" &&
    suggestion.originalPoint.every((value, index) => value === expectation.blockedOriginalPoint[index])
  );
  if (!repair) {
    issues.push("GridNav did not return a nearby repair for the deliberately blocked point.");
  } else {
    if (
      expectation.blockedSuggestedPoint &&
      !repair.suggestedPoint.every((value, index) => value === expectation.blockedSuggestedPoint?.[index])
    ) {
      issues.push(
        `The blocked-point repair moved from ${expectation.blockedSuggestedPoint.join(",")} ` +
          `to ${repair.suggestedPoint.join(",")}.`,
      );
    }
    if (
      expectation.blockedGridOffset &&
      !repair.gridOffset.every((value, index) => value === expectation.blockedGridOffset?.[index])
    ) {
      issues.push(
        `The blocked-point grid offset moved from ${expectation.blockedGridOffset.join(",")} ` +
          `to ${repair.gridOffset.join(",")}.`,
      );
    }
  }

  return { passed: issues.length === 0, issues, repairSuggestions };
}
