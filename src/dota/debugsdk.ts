// Attach / detach the bundled MCP DebugSDK (src/data/debug-sdk/mcp_debug.lua) to an
// addon. The SDK is a self-contained Lua module that registers `mcp_*` console
// commands the MCP drives over VConsole. "Attaching" = copy the lua into the addon's
// runtime vscripts dir + wire a `require("mcp_debug")` into the game-mode bootstrap.
//
// It works for both layouts:
//   - ts-template: requires from src/vscripts/addon_game_mode.ts (tstl emits the require)
//   - raw / runtime: requires from game/scripts/vscripts/addon_game_mode.lua
// Re-running is idempotent (guarded by a marker comment). detach removes both.

import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { AddonProject } from "./project.js";
import { resolveDataPath } from "../util/datapath.js";
import { pathExists, ensureDir } from "../util/fsx.js";

const MARKER = "[MCP DebugSDK]";
const CAMERA_MARKER = "[MCP DebugSDK Camera]";

const LUA_SNIPPET =
  `-- ${MARKER} auto-attached; remove this line + mcp_debug.lua to detach\n` +
  `pcall(require, "mcp_debug")\n`;

const TS_SNIPPET =
  `// ${MARKER} auto-attached; remove these two lines to detach\n` +
  `declare function require(module: string): unknown;\n` +
  `require("mcp_debug");\n`;

export interface AttachResult {
  copiedTo: string[];
  bootstrapFile?: string;
  bootstrapAction: "inserted" | "already-present" | "not-found" | "skipped (dryRun)";
  instructions: string[];
  dryRun: boolean;
  cameraBridge?: {
    copiedTo: string[];
    manifestFile: string;
    manifestAction: "created" | "inserted" | "already-present" | "skipped (dryRun)";
  };
}

export interface AttachDebugSdkOptions {
  /** Install the tiny Panorama telemetry/framing panel used by engine visual tests. */
  cameraBridge?: boolean;
}

async function bundledSdkPath(): Promise<string> {
  return resolveDataPath("debug-sdk/mcp_debug.lua");
}

async function attachCameraBridge(
  project: AddonProject,
  dryRun: boolean,
): Promise<NonNullable<AttachResult["cameraBridge"]>> {
  const layoutSource = await resolveDataPath("debug-sdk/mcp_debug_camera.xml");
  const scriptSource = await resolveDataPath("debug-sdk/mcp_debug_camera.js");
  const layoutDestination = join(project.panoramaContentDir, "layout", "custom_game", "mcp_debug_camera.xml");
  const scriptDestination = join(project.panoramaContentDir, "scripts", "custom_game", "mcp_debug_camera.js");
  const manifestFile = join(project.panoramaContentDir, "layout", "custom_game", "custom_ui_manifest.xml");
  const copiedTo = [layoutDestination, scriptDestination];
  const manifestEntry =
    `    <!-- ${CAMERA_MARKER} auto-attached -->\n` +
    '    <CustomUIElement type="Hud" layoutfile="file://{resources}/layout/custom_game/mcp_debug_camera.xml" />';

  const manifestExists = await pathExists(manifestFile);
  const manifestText = manifestExists ? await readFile(manifestFile, "utf8") : "";
  let manifestAction: NonNullable<AttachResult["cameraBridge"]>["manifestAction"] = manifestText.includes(CAMERA_MARKER)
    ? "already-present"
    : manifestExists
      ? "inserted"
      : "created";

  if (dryRun) {
    return { copiedTo, manifestFile, manifestAction: "skipped (dryRun)" };
  }

  await ensureDir(join(layoutDestination, ".."));
  await ensureDir(join(scriptDestination, ".."));
  await Promise.all([
    copyFile(layoutSource, layoutDestination),
    copyFile(scriptSource, scriptDestination),
  ]);

  if (manifestAction === "created") {
    await ensureDir(join(manifestFile, ".."));
    await writeFile(manifestFile, `<root>\n  <Panel>\n${manifestEntry}\n  </Panel>\n</root>\n`, "utf8");
  } else if (manifestAction === "inserted") {
    const panelClose = manifestText.lastIndexOf("</Panel>");
    const rootClose = manifestText.lastIndexOf("</root>");
    const insertionPoint = panelClose >= 0 ? panelClose : rootClose;
    if (insertionPoint < 0) {
      throw new Error(`Cannot safely add the DebugSDK camera bridge: malformed Panorama manifest ${manifestFile}`);
    }
    const indent = panelClose >= 0 ? "" : "  ";
    const updated =
      manifestText.slice(0, insertionPoint) +
      `${indent}${manifestEntry}\n` +
      manifestText.slice(insertionPoint);
    await writeFile(manifestFile, updated, "utf8");
  }

  return { copiedTo, manifestFile, manifestAction };
}

/** Find the best bootstrap file to wire the require into. */
async function findBootstrap(project: AddonProject): Promise<{ file: string; kind: "ts" | "lua" } | undefined> {
  const candidates: { file: string; kind: "ts" | "lua" }[] = [];
  if (project.tsVscriptsDir) candidates.push({ file: join(project.tsVscriptsDir, "addon_game_mode.ts"), kind: "ts" });
  candidates.push({ file: join(project.vscriptsOutDir, "addon_game_mode.lua"), kind: "lua" });
  candidates.push({ file: join(project.root, "scripts", "vscripts", "addon_game_mode.lua"), kind: "lua" });
  for (const c of candidates) {
    if (await pathExists(c.file)) return c;
  }
  return undefined;
}

export async function attachDebugSdk(
  project: AddonProject,
  dryRun = false,
  options: AttachDebugSdkOptions = {},
): Promise<AttachResult> {
  const src = await bundledSdkPath();
  const instructions: string[] = [];
  const copiedTo: string[] = [];

  // Runtime location Lua's require() resolves against.
  const runtimeDest = join(project.vscriptsOutDir, "mcp_debug.lua");
  copiedTo.push(runtimeDest);
  // For ts-template, also keep a copy next to source so a clean rebuild still has it
  // available where teams keep loose lua (harmless if unused).
  if (project.tsVscriptsDir) copiedTo.push(join(project.tsVscriptsDir, "mcp_debug.lua"));

  const boot = await findBootstrap(project);
  let bootstrapAction: AttachResult["bootstrapAction"] = boot ? "inserted" : "not-found";
  let bootstrapFile = boot?.file;

  if (boot) {
    const existing = await readFile(boot.file, "utf8");
    if (existing.includes(MARKER)) {
      bootstrapAction = "already-present";
    }
  }

  if (dryRun) {
    instructions.push(`[dry run] would copy mcp_debug.lua -> ${copiedTo.join(", ")}`);
    if (boot && bootstrapAction !== "already-present") {
      instructions.push(`[dry run] would insert require into ${boot.file} (${boot.kind})`);
    }
    const cameraBridge = options.cameraBridge ? await attachCameraBridge(project, true) : undefined;
    if (cameraBridge) {
      instructions.push(`[dry run] would install camera telemetry/framing bridge -> ${cameraBridge.copiedTo.join(", ")}`);
    }
    return { copiedTo, bootstrapFile, bootstrapAction: "skipped (dryRun)", instructions, dryRun: true, cameraBridge };
  }

  // Copy the SDK.
  for (const dest of copiedTo) {
    await ensureDir(join(dest, ".."));
    await copyFile(src, dest);
  }

  // Wire the require.
  if (boot && bootstrapAction === "inserted") {
    const existing = await readFile(boot.file, "utf8");
    const snippet = boot.kind === "ts" ? TS_SNIPPET : LUA_SNIPPET;
    await writeFile(boot.file, snippet + "\n" + existing, "utf8");
    instructions.push(`Wired require into ${boot.file}.`);
  } else if (!boot) {
    instructions.push(
      "No addon_game_mode bootstrap found. Add this where your game mode initializes:",
      project.hasTstl ? TS_SNIPPET.trim() : LUA_SNIPPET.trim(),
    );
  } else {
    instructions.push("Bootstrap already references the DebugSDK — left as-is.");
  }

  if (project.hasTstl && boot?.kind === "ts") {
    instructions.push("Run addon_build (tstl) so the require compiles, then dota_restart_game.");
  } else {
    instructions.push("Run dota_restart_game (or attach before launching) so the SDK loads.");
  }
  instructions.push('Verify with: dota_send_console_command command="mcp_ping" (expect "[MCP] PONG ...").');

  const cameraBridge = options.cameraBridge ? await attachCameraBridge(project, false) : undefined;
  if (cameraBridge) {
    instructions.push("Camera telemetry/framing bridge installed; compile addon content before using mcp_camera or mcp_frame.");
  }

  return { copiedTo, bootstrapFile, bootstrapAction, instructions, dryRun: false, cameraBridge };
}

export interface DetachResult {
  removedFiles: string[];
  bootstrapFile?: string;
  bootstrapCleaned: boolean;
}

async function removeCameraManifestEntry(file: string): Promise<boolean> {
  if (!(await pathExists(file))) return false;
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const kept: string[] = [];
  let removed = false;
  let skipEntry = false;
  for (const line of lines) {
    if (line.includes(CAMERA_MARKER)) {
      removed = true;
      skipEntry = true;
      continue;
    }
    if (skipEntry && line.includes("mcp_debug_camera.xml")) {
      skipEntry = false;
      continue;
    }
    skipEntry = false;
    kept.push(line);
  }
  if (removed) await writeFile(file, kept.join("\n"), "utf8");
  return removed;
}

async function removeMarkerBlock(file: string): Promise<boolean> {
  if (!(await pathExists(file))) return false;
  const text = await readFile(file, "utf8");
  if (!text.includes(MARKER)) return false;
  // Drop the marker line and the up-to-2 injected lines that follow it (the
  // require / declare lines for either the .lua or .ts snippet).
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let skip = 0;
  for (const line of lines) {
    if (line.includes(MARKER)) {
      skip = 2; // the snippet adds at most 2 lines after the marker
      continue;
    }
    if (skip > 0 && /mcp_debug|declare function require/.test(line)) {
      skip--;
      continue;
    }
    skip = 0;
    kept.push(line);
  }
  await writeFile(file, kept.join("\n").replace(/^\n+/, ""), "utf8");
  return true;
}

export async function detachDebugSdk(project: AddonProject): Promise<DetachResult> {
  const removedFiles: string[] = [];
  const { rm } = await import("node:fs/promises");
  for (const f of [join(project.vscriptsOutDir, "mcp_debug.lua"), project.tsVscriptsDir && join(project.tsVscriptsDir, "mcp_debug.lua")].filter(Boolean) as string[]) {
    if (await pathExists(f)) {
      await rm(f, { force: true });
      removedFiles.push(f);
    }
  }
  const boot = await findBootstrap(project);
  let bootstrapCleaned = false;
  if (boot) bootstrapCleaned = await removeMarkerBlock(boot.file);
  const cameraFiles = [
    join(project.panoramaContentDir, "layout", "custom_game", "mcp_debug_camera.xml"),
    join(project.panoramaContentDir, "scripts", "custom_game", "mcp_debug_camera.js"),
  ];
  for (const file of cameraFiles) {
    if (await pathExists(file)) {
      await rm(file, { force: true });
      removedFiles.push(file);
    }
  }
  await removeCameraManifestEntry(join(project.panoramaContentDir, "layout", "custom_game", "custom_ui_manifest.xml"));
  return { removedFiles, bootstrapFile: boot?.file, bootstrapCleaned };
}
