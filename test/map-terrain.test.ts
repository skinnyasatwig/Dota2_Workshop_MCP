import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseManagedTerrain,
  reconcileMapTerrain,
} from "../src/dota/map-terrain.js";

function tileGridFixture(): string {
  return (
    `"unrelated" "string" "preserve-me"\n` +
    `"tileGrid" "CMapDotaTileGrid"\n{\n` +
    `"origin" "vector3" "-256 -256 0"\n` +
    `"gridWidth" "int" "2"\n"gridHeight" "int" "2"\n` +
    `"verticesHeight" "int_array" [ "0", "0", "0", "0", "0", "0", "0", "0", "0" ]\n` +
    `"verticesWater" "bool_array" [ "0", "0", "0", "0", "0", "0", "0", "0", "0" ]\n` +
    `"cellsTileSet" "int_array" [ "0", "0", "0", "0" ]\n}\n`
  );
}

test("reconcileMapTerrain applies declared shapes and is idempotent", () => {
  const operations = parseManagedTerrain(
    [
      {
        op: "height",
        level: 2,
        shape: { kind: "rect", x0: 0, y0: 0, x1: 1, y1: 1 },
      },
      {
        op: "water",
        shape: { kind: "circle", cx: 1, cy: 1, r: 0.25 },
      },
      {
        op: "tileset",
        tileset: 1,
        shape: { kind: "rect", x0: 0, y0: 0, x1: 1, y1: 1 },
      },
    ],
    "managedTerrain",
    "fixture.json",
  )!;
  const first = reconcileMapTerrain(tileGridFixture(), operations);
  assert.equal(first.changed, true);
  assert.equal(first.changedHeightVertices, 4);
  assert.equal(first.changedWaterVertices, 1);
  assert.equal(first.changedTilesetCells, 1);
  assert.match(first.text, /preserve-me/);

  const second = reconcileMapTerrain(first.text, operations);
  assert.equal(second.changed, false);
  assert.equal(second.changedHeightVertices, 0);
  assert.equal(second.changedWaterVertices, 0);
  assert.equal(second.changedTilesetCells, 0);
  assert.equal(second.text, first.text);
});

test("parseManagedTerrain validates destructive scope and shape geometry", () => {
  assert.throws(
    () => parseManagedTerrain([{ op: "fill" }], "managedTerrain", "fixture.json"),
    /must set level, water, or tileset/,
  );
  assert.throws(
    () =>
      parseManagedTerrain(
        [
          {
            op: "height",
            level: 1,
            shape: { kind: "path", points: [[0, 0]], width: 2 },
          },
        ],
        "managedTerrain",
        "fixture.json",
      ),
    /at least two/,
  );
  assert.throws(
    () =>
      parseManagedTerrain(
        [
          {
            op: "tileset",
            tileset: -1,
            shape: { kind: "circle", cx: 1, cy: 1, r: 1 },
          },
        ],
        "managedTerrain",
        "fixture.json",
      ),
    /at least 0/,
  );
});
