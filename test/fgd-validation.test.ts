import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFgdEntities } from "../src/dota/fgd.js";
import {
  buildFgdDefinitionCatalog,
  validateEntitiesAgainstFgd,
} from "../src/dota/fgd-validation.js";

const CATALOG = buildFgdDefinitionCatalog(parseFgdEntities(`
@BaseClass = Targetname
[
  targetname(target_source) : "Name" : ""
]

@BaseClass = teamnumber
[
  teamnumber(integer) : "Team" : 0
]

@BaseClass base(Targetname, teamnumber) = dota_building
[
  invuln_count(integer) : "Links" : 0
  MapUnitName(string) : "Unit" : ""
  parentname(target_destination) : "Parent" : ""
  blend(float) [ min="0", max="1" ] : "Blend" : "0.5"
  mode(choices) : "Mode" : 0 =
  [
    0 : "Normal"
    1 : "Alternate"
  ]
]

@PointClass base(dota_building) = npc_dota_tower : "Tower"
[
]
`));

test("FGD catalogs resolve inherited keyvalues", () => {
  const properties = CATALOG.propertiesFor("npc_dota_tower");
  assert.deepEqual([...properties!.keys()].sort(), [
    "blend",
    "invuln_count",
    "mapunitname",
    "mode",
    "parentname",
    "targetname",
    "teamnumber",
  ]);
});

test("FGD validation checks known types and reports unknown data separately", () => {
  const report = validateEntitiesAgainstFgd([
    {
      classname: "npc_dota_tower",
      targetname: "tower",
      properties: {
        teamnumber: "radiant",
        MapUnitName: "npc_dota_goodguys_tower1_mid",
        custom_note: "blockout",
      },
    },
    {
      classname: "custom_script_entity",
      targetname: "custom",
      properties: {},
    },
  ], CATALOG);

  assert.equal(report.knownClassCount, 1);
  assert.deepEqual(report.unknownClassNames, ["custom_script_entity"]);
  assert.equal(report.unknownProperties[0].property, "custom_note");
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].code, "fgd-property-value-invalid");
});

test("strict FGD validation promotes unknown classes and properties to warnings", () => {
  const report = validateEntitiesAgainstFgd([
    {
      classname: "npc_dota_tower",
      targetname: "tower",
      properties: { custom_note: "blockout" },
    },
    { classname: "custom_entity", properties: {} },
  ], CATALOG, { strictUnknown: true });

  assert.deepEqual(report.findings.map((finding) => finding.code), [
    "fgd-property-unknown",
    "fgd-class-unknown",
  ]);
});

test("FGD validation checks Valve choices, ranges, and named destinations", () => {
  const report = validateEntitiesAgainstFgd([
    {
      classname: "npc_dota_tower",
      targetname: "tower",
      properties: {
        mode: "7",
        blend: "1.5",
        parentname: "missing_parent",
      },
    },
    {
      classname: "npc_dota_tower",
      targetname: "real_parent",
      properties: {
        mode: "1",
        blend: "0.25",
        parentname: "!activator",
      },
    },
  ], CATALOG);

  assert.deepEqual(report.findings.map((finding) => [finding.severity, finding.code]), [
    ["error", "fgd-property-choice-invalid"],
    ["error", "fgd-property-range-invalid"],
    ["warn", "fgd-target-missing"],
  ]);
  assert.deepEqual(
    [report.checkedChoiceCount, report.checkedRangeCount, report.checkedReferenceCount],
    [2, 2, 2],
  );
});
