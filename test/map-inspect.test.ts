import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectMapText } from "../src/dota/map-inspect.js";
import { buildEntityBlock } from "../src/dota/vmap.js";

function fixture(): string {
  const entities = [
    buildEntityBlock(
      {
        classname: "path_corner",
        origin: "-100 0 0",
        properties: { targetname: "route_1", target: "route_2" },
      },
      1,
    ),
    buildEntityBlock(
      {
        classname: "path_corner",
        origin: "100 0 0",
        properties: { targetname: "route_2" },
      },
      2,
    ),
    buildEntityBlock(
      {
        classname: "path_corner",
        origin: "0 100 0",
        properties: { targetname: "broken_1", target: "missing_2" },
      },
      3,
    ),
    buildEntityBlock(
      {
        classname: "info_target",
        origin: "300 0 0",
        properties: { targetname: "outside_marker" },
      },
      4,
    ),
  ];
  return (
    `"world" "CMapWorld"\n{\n"children" "element_array"\n[\n${entities.join(",\n")}\n]\n}\n` +
    `"tileGrid" "CMapDotaTileGrid"\n{\n` +
    `"origin" "vector3" "-256 -256 0"\n` +
    `"gridWidth" "int" "2"\n"gridHeight" "int" "2"\n` +
    `"verticesHeight" "int_array" [ "0", "0", "1", "0", "1", "1", "0", "0", "0" ]\n` +
    `"verticesWater" "bool_array" [ "0", "0", "0", "0", "1", "0", "0", "0", "0" ]\n` +
    `"cellsTileSet" "int_array" [ "0", "1", "1", "0" ]\n}\n`
  );
}

test("inspectMapText summarizes terrain, classes, paths, and findings", () => {
  const report = inspectMapText(fixture(), { includePathNodes: true });
  assert.equal(report.entityCount, 4);
  assert.equal(report.namedEntityCount, 4);
  assert.deepEqual(report.classCounts, { info_target: 1, path_corner: 3 });
  assert.deepEqual(report.terrain, {
    width: 2,
    height: 2,
    tileSize: 256,
    origin: [-256, -256, 0],
    worldBounds: { min: [-256, -256], max: [256, 256] },
    minHeight: 0,
    maxHeight: 1,
    waterVertexCount: 1,
    tilesets: { "0": 2, "1": 2 },
  });
  const route = report.paths.find((path) => path.start === "route_1");
  assert.equal(route?.nodeCount, 2);
  assert.equal(route?.end, "route_2");
  assert.deepEqual(route?.nodes?.map((node) => node.targetname), ["route_1", "route_2"]);
  assert.equal(route?.terrain?.sampleSpacing, 128);
  assert.ok((route?.terrain?.waterSampleCount ?? 0) > 0);
  assert.equal(route?.terrain?.passable, false);
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "broken-path-target" && finding.targetname === "broken_1",
    ),
  );
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "entity-out-of-bounds" && finding.targetname === "outside_marker",
    ),
  );
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "path-crosses-water" && finding.targetname === "route_1",
    ),
  );
});

test("inspectMapText filters named entities and respects limits", () => {
  const report = inspectMapText(fixture(), {
    targetnamePrefix: "route_",
    includeProperties: true,
    limit: 1,
  });
  assert.equal(report.matchedCount, 2);
  assert.equal(report.returnedCount, 1);
  assert.equal(report.truncated, true);
  assert.equal(report.entities[0].targetname, "route_1");
  assert.equal(report.entities[0].properties?.target, "route_2");
  assert.equal(report.paths[0].nodes, undefined);
});

test("inspectMapText can disable route terrain sampling", () => {
  const report = inspectMapText(fixture(), { checkPathability: false });
  assert.ok(report.paths.every((path) => path.terrain === undefined));
  assert.ok(
    report.findings.every(
      (finding) => !finding.code.startsWith("path-") || finding.code === "broken-path-target",
    ),
  );
});

test("inspectMapText flags abrupt sampled terrain changes", () => {
  const report = inspectMapText(fixture(), { maxTerrainStep: 0.1 });
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "path-steep-terrain" && finding.targetname === "route_1",
    ),
  );
});

test("inspectMapText flags path samples outside the tile grid", () => {
  const outside = buildEntityBlock(
    {
      classname: "path_corner",
      origin: "400 100 0",
      properties: { targetname: "outside_route_1" },
    },
    5,
  );
  const text = fixture().replace(
    '\n]\n}\n"tileGrid"',
    `,\n${outside}\n]\n}\n"tileGrid"`,
  );
  const report = inspectMapText(text);
  assert.ok(
    report.findings.some(
      (finding) => finding.code === "path-out-of-bounds" && finding.targetname === "outside_route_1",
    ),
  );
});
