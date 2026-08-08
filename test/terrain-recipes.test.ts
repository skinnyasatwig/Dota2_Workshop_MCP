import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIFF_RECIPE_SETS,
  CORE_TERRAIN_RECIPES,
  ORIENTATION_BY_PATTERN,
  VALVE_PREFAB_RECIPES,
  coreTileNodeForPattern,
  cornerPattern,
  terrainRecipeForCell,
  validateTerrainRecipeLibrary,
} from "../src/dota/terrain-recipes.js";

test("terrain recipe library is internally valid and complete", () => {
  assert.deepEqual(validateTerrainRecipeLibrary(), []);
  assert.equal(Object.keys(ORIENTATION_BY_PATTERN).length, 16);
  assert.equal(CORE_TERRAIN_RECIPES.length, 5);
  assert.equal(CLIFF_RECIPE_SETS.length, 2);
  assert.ok(VALVE_PREFAB_RECIPES.length >= 10);
});

test("corner profiles resolve to the known Valve core tile nodes", () => {
  assert.equal(cornerPattern([0, 0, 0, 0]), "0000");
  assert.equal(cornerPattern([1, 0, 0, 0]), "1000");
  assert.equal(coreTileNodeForPattern("0000"), 5292);
  assert.equal(coreTileNodeForPattern("1000"), 5183);
  assert.equal(coreTileNodeForPattern("1100"), 5186);
  assert.equal(coreTileNodeForPattern("1001"), 5177);
  assert.equal(coreTileNodeForPattern("1110"), 5180);
});

test("cliffs use tileset decoration while ramps and unknown tilesets stay safe", () => {
  assert.equal(terrainRecipeForCell("1000", 0, false)[1], -1);
  assert.equal(terrainRecipeForCell("1000", 0, false).length, 12);
  assert.equal(terrainRecipeForCell("1000", 1, false).length, 12);
  assert.deepEqual(terrainRecipeForCell("1000", 0, true), [5183, -1]);
  assert.deepEqual(terrainRecipeForCell("1000", 99, false), [5183, -1]);
  assert.deepEqual(terrainRecipeForCell("1001", 0, false), [5177, -1]);
});

test("Valve prefab recipes are stable, categorized source references", () => {
  const ids = new Set(VALVE_PREFAB_RECIPES.map((recipe) => recipe.id));
  assert.equal(ids.size, VALVE_PREFAB_RECIPES.length);
  assert.ok(VALVE_PREFAB_RECIPES.some((recipe) => recipe.category === "ancient"));
  assert.ok(VALVE_PREFAB_RECIPES.some((recipe) => recipe.category === "camp"));
  assert.ok(VALVE_PREFAB_RECIPES.every((recipe) => recipe.source.startsWith("maps/prefabs/")));
});
