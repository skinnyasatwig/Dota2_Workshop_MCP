import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANIMATED_PROP_RECIPE_IDS,
  ANIMATED_PROP_RECIPES,
  animatedPropSequence,
  inspectAnimatedPropRecipeInstallation,
  validateAnimatedPropRecipeLibrary,
} from "../src/dota/animated-prop-recipes.js";

test("checked animated-prop recipes are tiny, visual-only, and internally valid", () => {
  assert.deepEqual(validateAnimatedPropRecipeLibrary(), []);
  assert.deepEqual(ANIMATED_PROP_RECIPE_IDS, ["radiant-team-banner", "dire-team-banner"]);
  assert.ok(Object.values(ANIMATED_PROP_RECIPES).every((recipe) =>
    recipe.collision === "none" &&
    recipe.createNavObstacle === false &&
    recipe.useAnimGraph === false &&
    recipe.animateOnServer === false));
  assert.equal(
    animatedPropSequence("radiant-team-banner", "banner_radiant_idle2")?.looping,
    true,
  );
  assert.equal(animatedPropSequence("radiant-team-banner", "invented"), undefined);
});

test("animated-prop installation is exact and CRC-gated", () => {
  const compiled = new Map(
    Object.values(ANIMATED_PROP_RECIPES)
      .map((recipe) => [`${recipe.model}_c`.toUpperCase(), { crc: recipe.compiledCrc }]),
  );
  const complete = inspectAnimatedPropRecipeInstallation(compiled);
  assert.equal(complete.complete, true);
  assert.equal(complete.modelCount, 2);
  assert.equal(complete.installedCount, 2);
  assert.equal(complete.currentCount, 2);
  assert.equal(complete.metadataVerified, true);
  assert.deepEqual(complete.missing, []);
  assert.deepEqual(complete.stale, []);

  compiled.delete("MODELS/PROPS_TEAMS/BANNER_DIRE.VMDL_C");
  compiled.set("MODELS/PROPS_TEAMS/BANNER_RADIANT.VMDL_C", { crc: 123 });
  const changed = inspectAnimatedPropRecipeInstallation(compiled);
  assert.equal(changed.complete, false);
  assert.equal(changed.installedCount, 1);
  assert.equal(changed.currentCount, 0);
  assert.deepEqual(changed.missing, ["models/props_teams/banner_dire.vmdl"]);
  assert.deepEqual(changed.stale, [{
    model: "models/props_teams/banner_radiant.vmdl",
    expectedCrc: 1446545301,
    installedCrc: 123,
  }]);
});
