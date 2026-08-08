import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDotaBuildingEntities,
  validateDotaNeutralSpawners,
} from "../src/dota/map-semantics.js";
import { ParsedMapEntity } from "../src/dota/vmap.js";

function building(
  classname: string,
  targetname: string,
  teamnumber: string,
  MapUnitName?: string,
): ParsedMapEntity {
  return {
    classname,
    targetname,
    properties: {
      classname,
      targetname,
      teamnumber,
      ...(MapUnitName ? { MapUnitName } : {}),
    },
  };
}

test("stock Radiant and Dire forts pass semantic validation", () => {
  const findings = validateDotaBuildingEntities([
    building("npc_dota_fort", "dota_goodguys_fort", "2", "npc_dota_goodguys_fort"),
    building("npc_dota_fort", "dota_badguys_fort", "3", "npc_dota_badguys_fort"),
  ]);
  assert.deepEqual(findings, []);
});

test("forts with missing or tower MapUnitName values fail validation", () => {
  const findings = validateDotaBuildingEntities([
    building("npc_dota_fort", "dota_goodguys_fort", "2", "npc_dota_goodguys_tower2_mid"),
    building("npc_dota_fort", "dota_badguys_fort", "3"),
  ]);
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ["fort-unit-name-mismatch", "fort-unit-name-mismatch"],
  );
  assert.match(findings[0].message, /npc_dota_goodguys_fort/);
  assert.match(findings[1].message, /npc_dota_badguys_fort/);
});

test("tower unit names cannot belong to the opposing team", () => {
  const findings = validateDotaBuildingEntities([
    building("npc_dota_tower", "radiant_t1", "2", "npc_dota_badguys_tower1_mid"),
  ]);
  assert.equal(findings[0].code, "building-team-unit-mismatch");
});

test("native neutral spawners require a real named camp volume", () => {
  const spawner = building("npc_dota_neutral_spawner", "top_hard", "4");
  assert.equal(
    validateDotaNeutralSpawners([spawner])[0].code,
    "neutral-spawner-volume-missing",
  );

  spawner.properties.VolumeName = "top_hard_volume";
  assert.equal(
    validateDotaNeutralSpawners([spawner])[0].code,
    "neutral-spawner-volume-target-missing",
  );

  const volume: ParsedMapEntity = {
    classname: "trigger_multiple",
    targetname: "top_hard_volume",
    properties: {
      classname: "trigger_multiple",
      targetname: "top_hard_volume",
    },
  };
  assert.deepEqual(validateDotaNeutralSpawners([spawner, volume]), []);
});
