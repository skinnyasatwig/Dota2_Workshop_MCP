import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseMapSpecification } from "../src/dota/map-spec.js";
import {
  buildEngineNavigationCommand,
  engineNavigationRoutesFromManagedPaths,
} from "../src/dota/engine-nav-test.js";

test("full automation fixture crosses specification, components, terrain, and engine-nav layers", async () => {
  const fixture = new URL("./fixtures/full-automation-spec.json", import.meta.url);
  const specification = parseMapSpecification(
    JSON.parse(await readFile(fixture, "utf8")),
    fixture.pathname,
  );

  assert.equal(specification.map, "automation_acceptance");
  assert.deepEqual(
    specification.managedPaths?.map((path) => path.name),
    ["north_lane_route", "south_lane_route"],
  );
  assert.ok(specification.managedEntities?.some((entity) => entity.targetname === "radiant_t1"));
  assert.ok(specification.managedEntities?.some((entity) => entity.targetname === "dire_start"));
  assert.ok(specification.managedTerrain?.some((operation) => operation.op === "ramp"));
  assert.ok(specification.managedTerrain?.some((operation) => operation.op === "water"));

  const routes = engineNavigationRoutesFromManagedPaths(specification.managedPaths ?? []);
  assert.equal(routes.length, 2);
  for (const route of routes) {
    const command = buildEngineNavigationCommand(route, "both");
    assert.match(command, /GridNav:CanFindPath/);
    assert.match(command, new RegExp(route.name));
  }
});
