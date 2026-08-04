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
]

@PointClass base(dota_building) = npc_dota_tower : "Tower"
[
]
`));

test("FGD catalogs resolve inherited keyvalues", () => {
  const properties = CATALOG.propertiesFor("npc_dota_tower");
  assert.deepEqual([...properties!.keys()].sort(), ["invuln_count", "mapunitname", "targetname", "teamnumber"]);
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
