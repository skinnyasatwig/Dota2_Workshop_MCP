import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryForFgdEntity, parseFgdEntities } from "../src/dota/fgd.js";

const SAMPLE = `
@PointClass base(Targetname)
= npc_dota_neutral_spawner: "Spawns neutral units."
[
  NeutralType(choices) : "Camp Type" : 0 =
  [
    0: "Easy"
    1: "Moderate"
  ]
  VolumeName(target_destination) : "Volume Name" : ""
  input SpawnNow(void) : "Spawn immediately."
  output OnSpawnerExhausted(void) : "Fired when exhausted."
]

@SolidClass base(Targetname) = trigger_hero: "Hero trigger."
[
  StartDisabled(boolean) : "Start Disabled" : 0
]
`;

test("parseFgdEntities extracts classes, bases, and top-level properties", () => {
  const entities = parseFgdEntities(SAMPLE);
  assert.equal(entities.length, 2);
  assert.deepEqual(entities[0], {
    name: "npc_dota_neutral_spawner",
    classType: "PointClass",
    description: "Spawns neutral units.",
    bases: ["Targetname"],
    properties: [
      { name: "NeutralType", type: "choices", kind: "keyvalue" },
      { name: "VolumeName", type: "target_destination", kind: "keyvalue" },
      { name: "SpawnNow", type: "void", kind: "input" },
      { name: "OnSpawnerExhausted", type: "void", kind: "output" },
    ],
  });
  assert.equal(entities[1].classType, "SolidClass");
});

test("parseFgdEntities includes base and override classes without descriptions", () => {
  const entities = parseFgdEntities(`
@BaseClass = teamnumber
[
  teamnumber(choices) : "Team Number" : 0 =
  [
    0: "Unassigned"
    2: "Good Guys"
  ]
]

@BaseClass base(Targetname, teamnumber) = dota_building
[
  MapUnitName(string) : "Unit Name" : ""
]

@OverrideClass = prop_dynamic_base
[
  StartingAnim(sequence) : "Starting Animation" : ""
]
`);

  assert.deepEqual(entities.map(({ name, classType, bases }) => ({ name, classType, bases })), [
    { name: "teamnumber", classType: "BaseClass", bases: [] },
    { name: "dota_building", classType: "BaseClass", bases: ["Targetname", "teamnumber"] },
    { name: "prop_dynamic_base", classType: "OverrideClass", bases: [] },
  ]);
  assert.equal(entities[0].properties[0].name, "teamnumber");
  assert.equal(entities[1].properties[0].name, "MapUnitName");
});

test("categoryForFgdEntity groups official Dota entities for catalog filtering", () => {
  assert.equal(categoryForFgdEntity("npc_dota_neutral_spawner"), "spawn");
  assert.equal(categoryForFgdEntity("ent_dota_tree"), "prop");
  assert.equal(categoryForFgdEntity("trigger_hero"), "trigger");
});
