import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMapContract } from "../src/dota/map-contract.js";

async function freshRoot(): Promise<string> {
  const root = join(tmpdir(), "mcp-map-contract");
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, ".dota-workshop"), { recursive: true });
  return root;
}

test("loadMapContract loads and validates the project default", async () => {
  const root = await freshRoot();
  const path = join(root, ".dota-workshop", "map-contract.json");
  await writeFile(
    path,
    JSON.stringify({
      map: "twin_gates",
      requiredEntities: [
        { targetname: "radiant_t1", classname: "npc_dota_tower" },
        { targetname: "path_radiant_north_1", classname: "path_corner" },
      ],
    }),
  );
  const resolved = await loadMapContract(root, "twin_gates");
  assert.equal(resolved?.path, path);
  assert.equal(resolved?.contract.requiredEntities.length, 2);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects a contract for another map", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({ map: "another_map", requiredEntities: [] }),
  );
  await assert.rejects(() => loadMapContract(root, "twin_gates"), /another_map.*twin_gates/);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract treats an absent default as optional", async () => {
  const root = join(tmpdir(), "mcp-map-contract-absent");
  await rm(root, { recursive: true, force: true });
  await mkdir(root);
  assert.equal(await loadMapContract(root, "twin_gates"), undefined);
  await rm(root, { recursive: true, force: true });
});
