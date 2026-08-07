#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { registerMapInAddonInfo } from "../src/dota/addoninfo.js";
import { buildRepositoryCompileFixtureText } from "../src/dota/compile-fixture.js";
import {
  BRIDGE_NAV_FIXTURE_DEBUG_SDK_VERSION,
  BRIDGE_NAV_FIXTURE_MAP,
  assessBridgeNavigationFixture,
  bridgeNavigationFixtureRoutesFromText,
  buildBridgeNavigationFixtureText,
  inspectBridgeNavigationFixture,
} from "../src/dota/bridge-nav-fixture.js";
import { attachDebugSdk } from "../src/dota/debugsdk.js";
import { closeTransientStallDialog, diagnoseDota } from "../src/dota/diagnose.js";
import {
  ENGINE_NAV_FIXTURE_DEBUG_SDK_VERSION,
  ENGINE_NAV_FIXTURE_MAP,
  ENGINE_NAV_FIXTURE_ROUTES,
  assessEngineNavigationFixture,
} from "../src/dota/engine-nav-fixture.js";
import {
  ensureEngineNavigationMapReady,
  executeEngineNavigationChecks,
} from "../src/dota/engine-nav-test.js";
import { waitForEngineWindow } from "../src/dota/engine-window.js";
import { restartGame, shutdownGame } from "../src/dota/game-session.js";
import { requireDotaPaths } from "../src/dota/paths.js";
import { isProcessRunning } from "../src/dota/process.js";
import { getVConsole } from "../src/dota/vconsole.js";
import { compileVmap, textToVmap, vmapToText } from "../src/dota/vmap.js";

const args = new Set(process.argv.slice(2));
const probe = args.has("--probe");
const bridge = args.has("--bridge");
const compileOnly = args.has("--compile-only");
const launchStrategy = args.has("--direct") ? "direct" : "steam";
const port = Number(process.env.DOTA2_VCONPORT || 29000);

function assertDisposablePath(parent, child, addonName) {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  if (relative(parentPath, childPath).startsWith("..") || childPath === parentPath) {
    throw new Error(`Refusing cleanup outside ${parentPath}: ${childPath}`);
  }
  if (!childPath.endsWith(`${sep}${addonName}`)) {
    throw new Error(`Refusing cleanup of a path not named ${addonName}: ${childPath}`);
  }
}

function fixtureProject(root, addonName, gameDir, contentDir) {
  return {
    root,
    type: "repo",
    addonName,
    gameDir,
    contentDir,
    npcDir: join(gameDir, "scripts", "npc"),
    vscriptsOutDir: join(gameDir, "scripts", "vscripts"),
    localizationFile: join(gameDir, "resource", "addon_english.txt"),
    panoramaContentDir: join(contentDir, "panorama"),
    hasTstl: false,
  };
}

async function main() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid VConsole port: ${port}`);
  if (await isProcessRunning("dota2.exe")) {
    throw new Error("Dota is already running. The disposable fixture refuses to replace a user session.");
  }

  const dota = await requireDotaPaths();
  const template = join(dota.contentDotaAddons, "addon_template", "maps", "template_map.vmap");
  if (!existsSync(template)) throw new Error(`Valve's blank-map template is missing: ${template}`);

  const fixtureMap = bridge ? BRIDGE_NAV_FIXTURE_MAP : ENGINE_NAV_FIXTURE_MAP;
  const debugSdkVersion = bridge ? BRIDGE_NAV_FIXTURE_DEBUG_SDK_VERSION : ENGINE_NAV_FIXTURE_DEBUG_SDK_VERSION;
  const addonName = `codex_mcp_${bridge ? "bridge_nav" : "nav"}_${process.pid}_${Date.now()}`;
  const contentAddon = join(dota.contentDotaAddons, addonName);
  const gameAddon = join(dota.gameDotaAddons, addonName);
  const contentMap = join(contentAddon, "maps", `${fixtureMap}.vmap`);
  const gameVpk = join(gameAddon, "maps", `${fixtureMap}.vpk`);
  assertDisposablePath(dota.contentDotaAddons, contentAddon, addonName);
  assertDisposablePath(dota.gameDotaAddons, gameAddon, addonName);

  let launchAttempted = false;
  try {
    await mkdir(dirname(contentMap), { recursive: true });
    await mkdir(join(gameAddon, "scripts", "vscripts"), { recursive: true });

    const structuralSeed = await vmapToText(dota.dmxconvertExe, template);
    await textToVmap(
      dota.dmxconvertExe,
      bridge ? buildBridgeNavigationFixtureText(structuralSeed) : buildRepositoryCompileFixtureText(structuralSeed),
      contentMap,
    );
    const roundTripped = await vmapToText(dota.dmxconvertExe, contentMap);
    if (bridge) {
      const inspection = inspectBridgeNavigationFixture(roundTripped);
      if ((inspection.terrainCenterDistance ?? 0) < 40000 ||
          inspection.navigationSurfaceNames.length !== 3 ||
          inspection.solidNames.length !== 0) {
        throw new Error(`The bridge fixture did not survive Valve's VMAP conversion: ${JSON.stringify(inspection)}`);
      }
    } else if (!roundTripped.includes("fixture_nav_obstruction")) {
      throw new Error("The fixture blocker did not survive Valve's VMAP conversion.");
    }

    const addonInfo = registerMapInAddonInfo(
      '"AddonInfo"\n{\n\t"maps" ""\n\t"IsPlayable" "1"\n}\n',
      fixtureMap,
      2,
    );
    await writeFile(join(gameAddon, "addoninfo.txt"), addonInfo, "utf8");
    await writeFile(
      join(gameAddon, "scripts", "vscripts", "addon_game_mode.lua"),
      "function Precache(context) end\nfunction Activate() end\n",
      "utf8",
    );
    const project = fixtureProject(process.cwd(), addonName, gameAddon, contentAddon);
    await attachDebugSdk(project, false);

    const compiled = await compileVmap(
      dota.resourceCompilerExe,
      dota.dotaGameDir,
      contentMap,
      gameVpk,
      true,
    );
    if (compiled.timedOut || compiled.code !== 0 || !existsSync(gameVpk)) {
      throw new Error(`Fixture compile failed.\n${compiled.stdout.slice(-2000)}\n${compiled.stderr.slice(-2000)}`);
    }

    if (compileOnly) {
      console.log(JSON.stringify({
        addonName,
        map: fixtureMap,
        bridge,
        compileOnly: true,
        inspection: bridge ? inspectBridgeNavigationFixture(roundTripped) : undefined,
        passed: true,
      }, null, 2));
      return;
    }

    launchAttempted = true;
    const launch = await restartGame(
      dota,
      addonName,
      fixtureMap,
      port,
      true,
      true,
      launchStrategy,
    );
    const vc = getVConsole(port);
    if (!vc.isConnected()) await vc.connectWithRetry(60_000, 1000);

    let diagnosis = await diagnoseDota();
    for (const blocker of diagnosis.blockers.filter((window) => window.role === "stall").slice(0, 3)) {
      await closeTransientStallDialog(blocker);
    }
    if (diagnosis.blockers.some((window) => window.role === "stall")) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      diagnosis = await diagnoseDota();
    }
    if (diagnosis.blocked) {
      const blocker = diagnosis.blockers[0];
      throw new Error(`Dota startup is blocked by ${blocker?.role}: ${blocker?.title || blocker?.className}`);
    }

    const windowPreparation = await waitForEngineWindow(true, 30_000, 500);
    if (!windowPreparation.ok) throw new Error(windowPreparation.error || "Dota's render window was not ready.");

    vc.clearRing();
    const readiness = await ensureEngineNavigationMapReady(
      vc,
      addonName,
      fixtureMap,
      3,
      120_000,
      5000,
    );
    if (!readiness.ready) throw new Error("The disposable fixture did not reach an active game state.");
    if (!readiness.line?.includes(`v=${debugSdkVersion}`)) {
      throw new Error(
        `Expected DebugSDK ${debugSdkVersion}, got: ${readiness.line || "no readiness line"}`,
      );
    }

    vc.clearRing();
    const routes = bridge
      ? bridgeNavigationFixtureRoutesFromText(roundTripped)
      : ENGINE_NAV_FIXTURE_ROUTES;
    const execution = await executeEngineNavigationChecks(vc, routes, "both", 10_000);
    const assessment = bridge
      ? assessBridgeNavigationFixture(execution)
      : assessEngineNavigationFixture(execution, {
          blockedOriginalPoint: [0, 384, 128],
          // The first --probe run discovers the installed engine's exact repair.
          blockedSuggestedPoint: probe ? undefined : [-32, 480, 128],
          blockedGridOffset: probe ? undefined : [-1, 1],
        });
    const consoleErrors = vc.recent(1000)
      .map((line) => line.text)
      .filter((line) => /(script error|stack traceback|assertion failed|lua runtime error|\.lua:\d+:)/i.test(line));
    if (consoleErrors.length) assessment.issues.push(...consoleErrors.map((line) => `console: ${line}`));
    assessment.passed = assessment.issues.length === 0;

    console.log(JSON.stringify({
      addonName,
      map: fixtureMap,
      bridge,
      probe,
      launch: { method: launch.method, fallbackUsed: launch.fallbackUsed },
      readiness: readiness.line,
      results: execution.results,
      repairSuggestions: "repairSuggestions" in assessment ? assessment.repairSuggestions : [],
      sameXyHeightAliased: "sameXyHeightAliased" in assessment ? assessment.sameXyHeightAliased : undefined,
      consoleErrors,
      passed: assessment.passed,
      issues: assessment.issues,
    }, null, 2));
    if (!assessment.passed) throw new Error(`Engine navigation fixture failed:\n${assessment.issues.join("\n")}`);
  } finally {
    let safeToClean = true;
    try {
      if (launchAttempted || await isProcessRunning("dota2.exe")) {
        const shutdown = await shutdownGame(port, 15_000);
        if (!shutdown.stopped) {
          safeToClean = false;
          console.error(`WARNING: ${shutdown.detail}`);
        }
      }
    } catch (error) {
      safeToClean = false;
      console.error(`WARNING: Dota shutdown check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (safeToClean) {
      await Promise.all([
        rm(contentAddon, { recursive: true, force: true }),
        rm(gameAddon, { recursive: true, force: true }),
      ]);
    } else {
      console.error(`Safety stop: leaving the isolated fixture for inspection:\n${contentAddon}\n${gameAddon}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
