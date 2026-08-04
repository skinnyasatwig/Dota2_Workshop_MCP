import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dotaComponentInputSchema, expandDotaComponents } from "../src/dota/dota-components.js";
import { loadOfficialDotaFgdCatalog, validateEntitiesAgainstFgd } from "../src/dota/fgd-validation.js";
import { parseMapEntities, reconcileMapEntities, textToVmap, vmapToText } from "../src/dota/vmap.js";

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
  "Valve definitions and dmxconvert accept checked base and FoW blockers",
  { skip: !(existsSync(converter) && existsSync(template)) },
  async () => {
    const components = [
      dotaComponentInputSchema.parse({
        kind: "baseBlocker",
        name: "fixture_base_blocker",
        team: "radiant",
        origin: [-1024, 0, 256],
        yaw: 90,
      }),
      dotaComponentInputSchema.parse({
        kind: "fowBlocker",
        name: "fixture_fow",
        points: [[-256, 512, 256], [0, 768, 256], [256, 512, 256]],
      }),
    ];
    const expanded = expandDotaComponents(components);
    const directory = await mkdtemp(join(tmpdir(), "d2-point-blocker-integration-"));
    try {
      const source = await vmapToText(converter, template);
      const generated = reconcileMapEntities(source, expanded.managedEntities);
      const binary = join(directory, "point-blocker-fixture.vmap");
      await textToVmap(converter, generated.text, binary);
      const entities = parseMapEntities(await vmapToText(converter, binary))
        .filter((entity) => entity.targetname?.startsWith("fixture_"));

      assert.deepEqual(
        entities.map(({ targetname, classname }) => ({ targetname, classname })).sort(
          (a, b) => a.targetname!.localeCompare(b.targetname!),
        ),
        [
          { targetname: "fixture_base_blocker", classname: "npc_dota_base_blocker" },
          { targetname: "fixture_fow_1", classname: "ent_fow_blocker_node" },
          { targetname: "fixture_fow_2", classname: "ent_fow_blocker_node" },
          { targetname: "fixture_fow_3", classname: "ent_fow_blocker_node" },
        ],
      );
      const byName = new Map(entities.map((entity) => [entity.targetname, entity]));
      assert.equal(byName.get("fixture_base_blocker")?.properties.teamnumber, "2");
      assert.equal(byName.get("fixture_fow_1")?.properties.TargetNode, "fixture_fow_2");
      assert.equal(byName.get("fixture_fow_2")?.properties.TargetNode, "fixture_fow_3");
      assert.equal(byName.get("fixture_fow_3")?.properties.TargetNode, undefined);

      const official = await loadOfficialDotaFgdCatalog(join(dotaRoot, "game", "dota"));
      const validation = validateEntitiesAgainstFgd(entities, official);
      assert.equal(validation.knownClassCount, 4);
      assert.equal(validation.findings.filter((finding) => finding.severity === "error").length, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
