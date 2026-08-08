import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildRepositoryCompileFixtureText } from "../src/dota/compile-fixture.js";
import { inspectMapMaterials } from "../src/dota/map-material.js";
import { compileVmap, textToVmap, vmapToText } from "../src/dota/vmap.js";
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
      assert.match(roundTripped, /fixture_bridge_deck/);
      assert.match(roundTripped, /fixture_irregular_platform_segment_01_deck/);
      assert.match(roundTripped, /MCP Nav Surface: fixture_bridge_walkable/);
      assert.match(roundTripped, /MCP Nav Surface: fixture_irregular_platform_segment_01_walkable/);
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
