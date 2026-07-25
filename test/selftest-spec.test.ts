import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSelftestSpec } from "../src/dota/selftest-spec.js";

async function freshRoot(): Promise<string> {
  const root = join(tmpdir(), `mcp-selftest-spec-${Date.now()}-${Math.random()}`);
  await mkdir(join(root, ".dota-workshop"), { recursive: true });
  return root;
}

test("loadSelftestSpec loads the project default", async () => {
  const root = await freshRoot();
  const path = join(root, ".dota-workshop", "selftest.json");
  await writeFile(
    path,
    JSON.stringify({
      map: "twin_gates",
      setupCommands: ["dota_select_hero npc_dota_hero_axe"],
      setupGameState: 3,
      readyGameState: 6,
      readyAssert: "PlayerResource:GetSelectedHeroEntity(0) ~= nil",
      asserts: ["MapDiagnostics.Run() == true"],
      screenshot: false,
    }),
  );

  const loaded = await loadSelftestSpec(root);
  assert.equal(loaded?.path, path);
  assert.equal(loaded?.spec.map, "twin_gates");
  assert.deepEqual(loaded?.spec.setupCommands, ["dota_select_hero npc_dota_hero_axe"]);
  assert.equal(loaded?.spec.setupGameState, 3);
  assert.equal(loaded?.spec.readyGameState, 6);
  assert.equal(loaded?.spec.readyAssert, "PlayerResource:GetSelectedHeroEntity(0) ~= nil");
  assert.deepEqual(loaded?.spec.asserts, ["MapDiagnostics.Run() == true"]);
  assert.equal(loaded?.spec.screenshot, false);
  await rm(root, { recursive: true, force: true });
});

test("loadSelftestSpec treats an absent default as optional", async () => {
  const root = await freshRoot();
  assert.equal(await loadSelftestSpec(root), undefined);
  await rm(root, { recursive: true, force: true });
});

test("loadSelftestSpec rejects unknown fields", async () => {
  const root = await freshRoot();
  const path = join(root, ".dota-workshop", "selftest.json");
  await writeFile(path, JSON.stringify({ map: "twin_gates", surprise: true }));
  await assert.rejects(() => loadSelftestSpec(root), /Invalid self-test recipe/);
  await rm(root, { recursive: true, force: true });
});
