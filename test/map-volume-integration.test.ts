import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMapVolumes, reconcileMapVolumes } from "../src/dota/map-volume.js";
import { textToVmap, vmapToText } from "../src/dota/vmap.js";

const dotaRoot = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta";
const converter = join(dotaRoot, "game", "bin", "win64", "dmxconvert.exe");
const template = join(
  dotaRoot,
  "content",
  "dota_addons",
  "addon_template",
  "maps",
  "template_map.vmap",
);

test(
  "Valve dmxconvert round-trips checked solid volume recipes",
  { skip: !(existsSync(converter) && existsSync(template)) },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "d2-volume-integration-"));
    try {
      const source = await vmapToText(converter, template);
      const generated = reconcileMapVolumes(source, [
        {
          targetname: "fixture_camp_bounds",
          recipe: "camp",
          center: [256, 512, 192],
          size: [768, 640, 384],
        },
        {
          targetname: "fixture_no_wards",
          recipe: "noWards",
          center: [1024, 512, 256],
          polygon: {
            points: Array.from({ length: 12 }, (_unused, index) => {
              const angle = (index / 12) * Math.PI * 2;
              return [Math.cos(angle) * 256, Math.sin(angle) * 256] as [number, number];
            }),
            height: 512,
          },
          yaw: 30,
        },
        {
          targetname: "fixture_player_clip",
          recipe: "playerClip",
          center: [1536, 512, 256],
          size: [128, 1024, 512],
        },
        {
          targetname: "fixture_sloped_trigger",
          recipe: "trigger",
          center: [2048, 512, 256],
          polygon: {
            points: [[-256, -128], [256, -128], [256, 128], [-256, 128]],
            bottom: [-128, -128, 0, 0],
            top: [128, 128, 256, 256],
          },
        },
      ]);
      const binary = join(directory, "volume-fixture.vmap");
      await textToVmap(converter, generated.text, binary);
      const roundTripped = parseMapVolumes(await vmapToText(converter, binary));

      assert.deepEqual(
        roundTripped
          .filter((volume) => volume.targetname.startsWith("fixture_"))
          .map(({ targetname, recipe, blocking }) => ({ targetname, recipe, blocking }))
          .sort((a, b) => a.targetname.localeCompare(b.targetname)),
        [
          { targetname: "fixture_camp_bounds", recipe: "camp", blocking: false },
          { targetname: "fixture_no_wards", recipe: "noWards", blocking: false },
          { targetname: "fixture_player_clip", recipe: "playerClip", blocking: true },
          { targetname: "fixture_sloped_trigger", recipe: "trigger", blocking: false },
        ],
      );
      assert.equal(roundTripped.find((volume) => volume.targetname === "fixture_no_wards")?.footprint.length, 12);
      assert.deepEqual(roundTripped.find((volume) => volume.targetname === "fixture_sloped_trigger")?.sloped, {
        bottom: [-128, -128, 0, 0],
        top: [128, 128, 256, 256],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
