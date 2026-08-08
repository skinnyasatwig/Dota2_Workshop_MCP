import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { attachDebugSdk, DEBUG_SDK_VERSION, detachDebugSdk } from "../src/dota/debugsdk.js";
import { AddonProject } from "../src/dota/project.js";
import { resolveDataPath } from "../src/util/datapath.js";

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

    assert.match(await readFile(first.copiedTo[0], "utf8"), new RegExp(`SDK_VERSION = "${DEBUG_SDK_VERSION.replace(/\./g, "\\.")}"`));

    const manifest = await readFile(first.cameraBridge!.manifestFile, "utf8");
    assert.equal((manifest.match(/mcp_debug_camera\.xml/g) ?? []).length, 1);
    assert.doesNotMatch(await readFile(first.cameraBridge!.copiedTo[0], "utf8"), /<Panel[^>]*\bid=/);
    const bridgeScript = await readFile(first.cameraBridge!.copiedTo[1], "utf8");
    assert.match(bridgeScript, /GetCameraLookAtPosition/);
    assert.match(bridgeScript, /SetCameraTargetPosition/);
    assert.match(bridgeScript, /SetCameraDistance/);
    assert.match(bridgeScript, /SetCameraPitchMin/);
    assert.match(bridgeScript, /WorldToScreenXYClamped/);
    const panoramaApi = JSON.parse(await readFile(await resolveDataPath("panorama-api.json"), "utf8"));
    const gameUi = panoramaApi.interfaces.find((entry: { name: string }) => entry.name === "CDOTA_PanoramaScript_GameUI");
    const methodNames = new Set(gameUi.members.map((member: { name: string }) => member.name));
    for (const method of [
      "SetCameraTarget",
      "SetCameraTargetPosition",
      "SetCameraTerrainAdjustmentEnabled",
      "SetCameraPitchMin",
      "SetCameraPitchMax",
      "SetCameraYaw",
      "SetCameraDistance",
      "SetCameraLookAtPositionHeightOffset",
      "GetCameraLookAtPosition",
      "GetCameraPosition",
      "WorldToScreenXYClamped",
    ]) {
      assert.equal(methodNames.has(method), true, `${method} is absent from the checked Panorama API catalog`);
    }

    const detached = await detachDebugSdk(project);
    assert.equal(detached.bootstrapCleaned, true);
    assert.equal(detached.removedFiles.length, 3);
    assert.doesNotMatch(await readFile(first.cameraBridge!.manifestFile, "utf8"), /MCP DebugSDK Camera/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
