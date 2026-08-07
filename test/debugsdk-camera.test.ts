import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { attachDebugSdk, detachDebugSdk } from "../src/dota/debugsdk.js";
import { AddonProject } from "../src/dota/project.js";

test("DebugSDK camera bridge attach is idempotent and detach removes only marked assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-camera-"));
  try {
    const project: AddonProject = {
      root,
      type: "raw",
      addonName: "camera_fixture",
      gameDir: join(root, "game"),
      contentDir: join(root, "content"),
      npcDir: join(root, "game", "scripts", "npc"),
      vscriptsOutDir: join(root, "game", "scripts", "vscripts"),
      localizationFile: join(root, "game", "resource", "addon_english.txt"),
      panoramaContentDir: join(root, "content", "panorama"),
      hasTstl: false,
    };
    await mkdir(project.vscriptsOutDir, { recursive: true });
    await writeFile(join(project.vscriptsOutDir, "addon_game_mode.lua"), "print('fixture')\n", "utf8");

    const first = await attachDebugSdk(project, false, { cameraBridge: true });
    assert.equal(first.bootstrapAction, "inserted");
    assert.equal(first.cameraBridge?.manifestAction, "created");
    const second = await attachDebugSdk(project, false, { cameraBridge: true });
    assert.equal(second.bootstrapAction, "already-present");
    assert.equal(second.cameraBridge?.manifestAction, "already-present");

    const manifest = await readFile(first.cameraBridge!.manifestFile, "utf8");
    assert.equal((manifest.match(/mcp_debug_camera\.xml/g) ?? []).length, 1);
    assert.doesNotMatch(await readFile(first.cameraBridge!.copiedTo[0], "utf8"), /<Panel[^>]*\bid=/);
    assert.match(await readFile(first.cameraBridge!.copiedTo[1], "utf8"), /GetCameraLookAtPosition/);

    const detached = await detachDebugSdk(project);
    assert.equal(detached.bootstrapCleaned, true);
    assert.equal(detached.removedFiles.length, 3);
    assert.doesNotMatch(await readFile(first.cameraBridge!.manifestFile, "utf8"), /MCP DebugSDK Camera/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
