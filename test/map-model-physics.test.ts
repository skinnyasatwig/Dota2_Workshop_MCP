import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMapContract } from "../src/dota/map-contract.js";
import { inspectManagedModelPhysics } from "../src/dota/map-model-physics.js";
import { buildEntityBlock, parseMapEntities } from "../src/dota/vmap.js";

const model = "models/props/checked_collision.vmdl";

function contract() {
  return parseMapContract({
    requiredEntities: [],
    managedEntities: [{
      targetname: "checked_prop",
      classname: "prop_static",
      origin: "10 20 30",
      scales: "2 1 0.5",
      modelPhysics: "required",
      properties: { model, solid: "6" },
    }],
  }, "physics fixture");
}

function mapEntity(properties: Record<string, string> = { model, solid: "6" }) {
  return parseMapEntities(buildEntityBlock({
    classname: "prop_static",
    origin: "10 20 30",
    scales: "2 1 0.5",
    properties: { targetname: "checked_prop", ...properties },
  }, 1));
}

test("managed model physics accepts only real decoded PHYS bounds", async () => {
  const report = await inspectManagedModelPhysics(
    mapEntity(),
    contract(),
    "base.vpk",
    async (_vpk, inspectedModel) => ({
      model: inspectedModel,
      status: "physical-bounds",
      bounds: [{ min: [-16, -8, 0], max: [16, 8, 32] }],
      source: "vrf-phys",
      fromCache: false,
      detail: "decoded fixture PHYS",
    }),
  );

  assert.equal(report.safeToWrite, true);
  assert.equal(report.requirementCount, 1);
  assert.equal(report.resolvedCount, 1);
  assert.equal(report.models[0].state, "resolved");
});

test("managed model physics fails closed for absent PHYS and ignores unmanaged props", async () => {
  const unmanaged = parseMapEntities(buildEntityBlock({
    classname: "prop_static",
    origin: "100 0 0",
    properties: {
      targetname: "legacy_unknown_prop",
      model: "models/props/legacy.vmdl",
      solid: "6",
    },
  }, 2))[0];
  const report = await inspectManagedModelPhysics(
    [...mapEntity(), unmanaged],
    contract(),
    "base.vpk",
    async (_vpk, inspectedModel) => ({
      model: inspectedModel,
      status: "no-physics",
      bounds: [],
      source: "vrf-phys",
      fromCache: false,
      detail: "The model has no non-empty PHYS block.",
    }),
  );

  assert.equal(report.safeToWrite, false);
  assert.equal(report.requirementCount, 1);
  assert.equal(report.unresolvedCount, 1);
  assert.equal(report.findings[0].code, "managed-model-physics-unresolved");
  assert.match(report.findings[0].detail, /no non-empty PHYS block/);
});

test("managed model physics catches VMAP drift before model inspection", async () => {
  let inspections = 0;
  const report = await inspectManagedModelPhysics(
    mapEntity({ model: "models/props/wrong.vmdl", solid: "0" }),
    contract(),
    "base.vpk",
    async (_vpk, inspectedModel) => {
      inspections++;
      return {
        model: inspectedModel,
        status: "physical-bounds",
        bounds: [{ min: [-1, -1, -1], max: [1, 1, 1] }],
        source: "vrf-phys",
        fromCache: false,
        detail: "should not run",
      };
    },
  );

  assert.equal(inspections, 0);
  assert.equal(report.safeToWrite, false);
  assert.equal(report.invalidCount, 1);
  assert.equal(report.findings[0].code, "managed-model-physics-model-mismatch");
});

test("managed model physics correlates results by targetname when one transform is malformed", async () => {
  const twoProps = parseMapContract({
    requiredEntities: [],
    managedEntities: ["bad_origin", "good_origin"].map((targetname) => ({
      targetname,
      classname: "prop_static",
      origin: targetname === "bad_origin" ? "not a vector" : "100 0 0",
      modelPhysics: "required",
      properties: { model, solid: "6" },
    })),
  }, "correlation fixture");
  const entities = [
    buildEntityBlock({
      classname: "prop_static",
      origin: "not a vector",
      properties: { targetname: "bad_origin", model, solid: "6" },
    }, 1),
    buildEntityBlock({
      classname: "prop_static",
      origin: "100 0 0",
      properties: { targetname: "good_origin", model, solid: "6" },
    }, 2),
  ].flatMap(parseMapEntities);
  const report = await inspectManagedModelPhysics(
    entities,
    twoProps,
    "base.vpk",
    async (_vpk, inspectedModel) => ({
      model: inspectedModel,
      status: "physical-bounds",
      bounds: [{ min: [-1, -1, -1], max: [1, 1, 1] }],
      source: "vrf-phys",
      fromCache: false,
      detail: "decoded fixture PHYS",
    }),
  );

  assert.deepEqual(report.models.map(({ targetname, state }) => ({ targetname, state })), [
    { targetname: "bad_origin", state: "unresolved" },
    { targetname: "good_origin", state: "resolved" },
  ]);
});

test("managed model physics accepts a known installed Dota PHYS hull", {
  skip: !process.env.DOTA2_TEST_VPK,
}, async () => {
  const installedModel = "models/props_gameplay/cap_point001.vmdl";
  const installedContract = parseMapContract({
    requiredEntities: [],
    managedEntities: [{
      targetname: "installed_checked_prop",
      classname: "prop_static",
      origin: "0 0 0",
      modelPhysics: "required",
      properties: { model: installedModel, solid: "6" },
    }],
  }, "installed PHYS fixture");
  const installedEntity = parseMapEntities(buildEntityBlock({
    classname: "prop_static",
    origin: "0 0 0",
    properties: { targetname: "installed_checked_prop", model: installedModel, solid: "6" },
  }, 1));

  const report = await inspectManagedModelPhysics(
    installedEntity,
    installedContract,
    process.env.DOTA2_TEST_VPK!,
  );
  assert.equal(report.safeToWrite, true, JSON.stringify(report.findings));
  assert.equal(report.resolvedCount, 1);
  assert.match(report.models[0].detail, /PHYS/i);
});
