import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectProject } from "../src/dota/project.js";

async function freshRoot(name: string): Promise<string> {
  const root = join(tmpdir(), name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

test("detectProject recognizes game/dota_addons repository layout", async () => {
  const root = await freshRoot("mcp-project-repo-layout");
  const gameDir = join(root, "game", "dota_addons", "twin_gates");
  await mkdir(join(gameDir, "scripts", "npc"), { recursive: true });
  await mkdir(join(root, "maps"), { recursive: true });

  const project = await detectProject(root);
  assert.equal(project.type, "repo");
  assert.equal(project.addonName, "twin_gates");
  assert.equal(project.gameDir, gameDir);
  assert.equal(project.contentDir, root, "legacy root/maps layout remains usable");
  await rm(root, { recursive: true, force: true });
});

test("detectProject prefers matching content/dota_addons repository tree", async () => {
  const root = await freshRoot("mcp-project-full-repo-layout");
  const gameDir = join(root, "game", "dota_addons", "twin_gates");
  const contentDir = join(root, "content", "dota_addons", "twin_gates");
  await mkdir(gameDir, { recursive: true });
  await mkdir(contentDir, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "twin_gates" }));

  const project = await detectProject(root);
  assert.equal(project.type, "repo");
  assert.equal(project.gameDir, gameDir);
  assert.equal(project.contentDir, contentDir);
  await rm(root, { recursive: true, force: true });
});

test("detectProject keeps direct game/content wrapper layout", async () => {
  const root = await freshRoot("mcp-project-direct-layout");
  await mkdir(join(root, "game", "scripts", "npc"), { recursive: true });
  await mkdir(join(root, "content", "maps"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "twin_gates" }));

  const project = await detectProject(root);
  assert.equal(project.type, "raw");
  assert.equal(project.addonName, "twin_gates");
  assert.equal(project.gameDir, join(root, "game"));
  assert.equal(project.contentDir, join(root, "content"));
  await rm(root, { recursive: true, force: true });
});
