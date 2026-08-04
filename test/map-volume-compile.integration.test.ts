import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { reconcileMapVolumes } from "../src/dota/map-volume.js";
import { compileVmap, textToVmap, vmapToText } from "../src/dota/vmap.js";

const dotaRoot = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta";
const converter = join(dotaRoot, "game", "bin", "win64", "dmxconvert.exe");
const compiler = join(dotaRoot, "game", "bin", "win64", "resourcecompiler.exe");
const dotaGame = join(dotaRoot, "game", "dota");
const template = join(dotaRoot, "content", "dota_addons", "addon_template", "maps", "template_map.vmap");
const enabled = process.env.DOTA2_MCP_COMPILE_INTEGRATION === "1";

test(
  "resourcecompiler accepts a checked polygon volume in an isolated temporary addon",
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
      const source = await vmapToText(converter, template);
      const generated = reconcileMapVolumes(source, [{
        targetname: "fixture_polygon_no_wards",
        recipe: "noWards",
        center: [0, 0, 256],
        polygon: {
          points: Array.from({ length: 16 }, (_unused, index) => {
            const angle = (index / 16) * Math.PI * 2;
            return [Math.cos(angle) * 512, Math.sin(angle) * 512] as [number, number];
          }),
          height: 512,
        },
      }]);
      await textToVmap(converter, generated.text, contentMap);
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
