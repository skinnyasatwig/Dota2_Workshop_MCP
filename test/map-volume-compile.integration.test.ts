import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildRepositoryCompileFixtureText } from "../src/dota/compile-fixture.js";
import { inspectMapMaterials } from "../src/dota/map-material.js";
import { inspectMapModels } from "../src/dota/map-model.js";
import { parseMapSolids } from "../src/dota/map-solid.js";
import { compileVmap, parseMapEntities, textToVmap, vmapToText } from "../src/dota/vmap.js";
import { Vpk } from "../src/dota/vpk.js";

const dotaRoot = process.env.DOTA2_PATH || "C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta";
const converter = join(dotaRoot, "game", "bin", "win64", "dmxconvert.exe");
const compiler = join(dotaRoot, "game", "bin", "win64", "resourcecompiler.exe");
const dotaGame = join(dotaRoot, "game", "dota");
const template = join(dotaRoot, "content", "dota_addons", "addon_template", "maps", "template_map.vmap");
const enabled = process.env.DOTA2_MCP_COMPILE_INTEGRATION === "1";

test(
  "resourcecompiler accepts the repository-owned VMAP fixture in an isolated temporary addon",
  {
    skip: !(enabled && existsSync(converter) && existsSync(compiler) && existsSync(template)),
    timeout: 600_000,
  },
  async () => {
    const addonName = `codex_mcp_polygon_${process.pid}_${Date.now()}`;
    const contentAddon = join(dotaRoot, "content", "dota_addons", addonName);
    const gameAddon = join(dotaRoot, "game", "dota_addons", addonName);
    const contentMap = join(contentAddon, "maps", "polygon_fixture.vmap");
    const gameVpk = join(gameAddon, "maps", "polygon_fixture.vpk");
    try {
      await mkdir(dirname(contentMap), { recursive: true });
      const structuralSeed = await vmapToText(converter, template);
      await textToVmap(
        converter,
        buildRepositoryCompileFixtureText(structuralSeed),
        contentMap,
      );
      const roundTripped = await vmapToText(converter, contentMap);
      assert.match(roundTripped, /fixture_polygon_no_wards/);
      assert.match(roundTripped, /fixture_sloped_trigger/);
      assert.match(roundTripped, /fixture_concave_solid/);
      assert.match(roundTripped, /fixture_sloped_concave_solid/);
      assert.match(roundTripped, /fixture_arch_lintel/);
      assert.match(roundTripped, /fixture_profile_arch_arch_segment_01/);
      assert.match(roundTripped, /materials\/dev\/reflectivity_50\.vmat/);
      assert.match(roundTripped, /materials\/dev\/reflectivity_20\.vmat/);
      assert.deepEqual(
        parseMapSolids(roundTripped).find((solid) =>
          solid.targetname === "fixture_profile_arch_arch_segment_01")?.faceTextureScales,
        { top: [0.25, 0.25], bottom: [-0.5, 0.5], sides: [0.5, 1] },
      );
      assert.deepEqual(
        parseMapSolids(roundTripped).find((solid) =>
          solid.targetname === "fixture_profile_arch_arch_segment_01")?.faceTextureShifts,
        { top: [0, 64], bottom: [-128, 256], sides: [16, -16] },
      );
      assert.deepEqual(
        parseMapSolids(roundTripped).find((solid) =>
          solid.targetname === "fixture_profile_arch_arch_segment_01")?.faceTextureRotations,
        { top: 45, bottom: -90, sides: 180 },
      );
      assert.deepEqual(
        parseMapSolids(roundTripped).find((solid) =>
          solid.targetname === "fixture_profile_arch_arch_segment_01")?.faceTextureAlignments,
        { top: "shared", bottom: "shared", sides: "shared" },
      );
      assert.match(roundTripped, /fixture_bridge_deck/);
      assert.match(roundTripped, /fixture_irregular_platform_segment_01_deck/);
      assert.match(roundTripped, /fixture_multi_hole_platform_triangle_001_deck/);
      assert.match(roundTripped, /fixture_decorative_rocks_west/);
      const decorativeRocks = parseMapEntities(roundTripped)
        .filter((entity) => entity.targetname?.startsWith("fixture_decorative_rocks_"));
      assert.equal(decorativeRocks.length, 2);
      assert.ok(decorativeRocks.every((entity) => entity.classname === "prop_static"));
      assert.ok(decorativeRocks.every((entity) => entity.properties.solid === "0"));
      assert.ok(decorativeRocks.every((entity) =>
        entity.properties.model === "models/props_debris/rock_debris001.vmdl"));
      assert.equal(
        decorativeRocks.find((entity) => entity.targetname === "fixture_decorative_rocks_west")?.scales,
        "1.25 1.25 1.25",
      );
      assert.equal(
        decorativeRocks.find((entity) => entity.targetname === "fixture_decorative_rocks_east")?.scales,
        "0.75 1 1.5",
      );
      assert.match(roundTripped, /MCP Nav Surface: fixture_bridge_walkable/);
      assert.match(roundTripped, /MCP Nav Surface: fixture_irregular_platform_segment_01_walkable/);
      assert.match(roundTripped, /MCP Nav Surface: fixture_multi_hole_platform_triangle_001_walkable/);
      assert.match(roundTripped, /materials\/editor\/dota_nav_walkable\.vmat/);
      const [dotaPak, corePak] = await Promise.all([
        Vpk.open(join(dotaRoot, "game", "dota", "pak01_dir.vpk")),
        Vpk.open(join(dotaRoot, "game", "core", "pak01_dir.vpk")),
      ]);
      const materials = await inspectMapMaterials({
        mapText: roundTripped,
        sourceRoots: [
          contentAddon,
          join(dotaRoot, "content", "dota"),
          join(dotaRoot, "content", "core"),
        ],
        compiledRoots: [
          gameAddon,
          join(dotaRoot, "game", "dota"),
          join(dotaRoot, "game", "core"),
        ],
        packedResources: [
          { label: "Dota pak01", entries: dotaPak.entries },
          { label: "core pak01", entries: corePak.entries },
        ],
      });
      assert.equal(materials.safeToWrite, true, JSON.stringify(materials.findings));
      assert.equal(materials.missingCount, 0);
      const models = await inspectMapModels({
        mapText: roundTripped,
        sourceRoots: [
          contentAddon,
          join(dotaRoot, "content", "dota"),
          join(dotaRoot, "content", "core"),
        ],
        compiledRoots: [
          gameAddon,
          join(dotaRoot, "game", "dota"),
          join(dotaRoot, "game", "core"),
        ],
        packedResources: [
          { label: "Dota pak01", entries: dotaPak.entries },
          { label: "core pak01", entries: corePak.entries },
        ],
      });
      assert.equal(models.safeToWrite, true, JSON.stringify(models.findings));
      assert.equal(models.missingCount, 0);
      assert.ok(models.models.some((model) =>
        model.model === "models/props_debris/rock_debris001.vmdl" && model.state === "resolved"));
      const compiled = await compileVmap(compiler, dotaGame, contentMap, gameVpk, true);
      assert.equal(compiled.timedOut, false, compiled.stderr || compiled.stdout);
      assert.equal(compiled.code, 0, compiled.stderr || compiled.stdout);
      assert.equal(existsSync(gameVpk), true, `Expected compiler output: ${gameVpk}`);
    } finally {
      await Promise.all([
        rm(contentAddon, { recursive: true, force: true }),
        rm(gameAddon, { recursive: true, force: true }),
      ]);
    }
  },
);
