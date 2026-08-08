#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { registerMapInAddonInfo } from "../src/dota/addoninfo.js";
import { buildRepositoryCompileFixtureText } from "../src/dota/compile-fixture.js";
import { captureEngineScreenshot } from "../src/dota/engine-screenshot.js";
import {
  ENGINE_ANIMATION_CLIENT_TARGET,
  ENGINE_ANIMATION_FIXTURE_DEBUG_SDK_VERSION,
  ENGINE_ANIMATION_FIXTURE_MAP,
  ENGINE_ANIMATION_FOCUS_TARGET,
  ENGINE_ANIMATION_FRAME_REGION,
  ENGINE_ANIMATION_MODEL,
  ENGINE_ANIMATION_SEQUENCE,
  ENGINE_ANIMATION_SERVER_TARGET,
  buildEngineAnimationFixtureText,
  inspectEngineAnimationFixture,
} from "../src/dota/engine-animation-fixture.js";
import {
  assessBannerFrameMotion,
  assessEngineAnimationSamples,
  compareAnimationFrames,
  requestEngineAnimationSample,
  requestEngineFocus,
} from "../src/dota/engine-animation-test.js";
import {
  BRIDGE_NAV_FIXTURE_DEBUG_SDK_VERSION,
  BRIDGE_NAV_FIXTURE_MAP,
  assessBridgeNavigationFixture,
  bridgeNavigationFixtureRoutesFromText,
  buildBridgeNavigationFixtureText,
  inspectBridgeNavigationFixture,
} from "../src/dota/bridge-nav-fixture.js";
import {
  RING_NAV_FIXTURE_DEBUG_SDK_VERSION,
  RING_NAV_FIXTURE_MAP,
  assessRingNavigationFixture,
  buildRingNavigationFixtureText,
  inspectRingNavigationFixture,
  ringNavigationFixtureRoutesFromText,
} from "../src/dota/ring-nav-fixture.js";
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
  waitForEngineNavigationReady,
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
const ring = args.has("--ring");
const animation = args.has("--animation");
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
  if ([bridge, ring, animation].filter(Boolean).length > 1) {
    throw new Error("Choose only one isolated fixture: --bridge, --ring, or --animation.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid VConsole port: ${port}`);
  if (await isProcessRunning("dota2.exe")) {
    throw new Error("Dota is already running. The disposable fixture refuses to replace a user session.");
  }

  const dota = await requireDotaPaths();
  const template = join(dota.contentDotaAddons, "addon_template", "maps", "template_map.vmap");
  if (!existsSync(template)) throw new Error(`Valve's blank-map template is missing: ${template}`);

  const fixtureMap = animation
    ? ENGINE_ANIMATION_FIXTURE_MAP
    : ring
    ? RING_NAV_FIXTURE_MAP
    : bridge ? BRIDGE_NAV_FIXTURE_MAP : ENGINE_NAV_FIXTURE_MAP;
  const debugSdkVersion = animation
    ? ENGINE_ANIMATION_FIXTURE_DEBUG_SDK_VERSION
    : ring
    ? RING_NAV_FIXTURE_DEBUG_SDK_VERSION
    : bridge ? BRIDGE_NAV_FIXTURE_DEBUG_SDK_VERSION : ENGINE_NAV_FIXTURE_DEBUG_SDK_VERSION;
  const fixtureKind = animation ? "animation" : ring ? "ring_nav" : bridge ? "bridge_nav" : "nav";
  const addonName = `codex_mcp_${fixtureKind}_${process.pid}_${Date.now()}`;
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
      animation
        ? buildEngineAnimationFixtureText(structuralSeed)
        : ring
        ? buildRingNavigationFixtureText(structuralSeed)
        : bridge ? buildBridgeNavigationFixtureText(structuralSeed) : buildRepositoryCompileFixtureText(structuralSeed),
      contentMap,
    );
    const roundTripped = await vmapToText(dota.dmxconvertExe, contentMap);
    if (animation) {
      const inspection = inspectEngineAnimationFixture(roundTripped);
      if (!inspection.passed) {
        throw new Error(`The animation fixture did not survive Valve's VMAP conversion: ${JSON.stringify(inspection.issues)}`);
      }
    } else if (bridge) {
      const inspection = inspectBridgeNavigationFixture(roundTripped);
      if ((inspection.terrainCenterDistance ?? 0) < 40000 ||
          inspection.navigationSurfaceNames.length !== 3 ||
          inspection.solidNames.length !== 0) {
        throw new Error(`The bridge fixture did not survive Valve's VMAP conversion: ${JSON.stringify(inspection)}`);
      }
    } else if (ring) {
      const inspection = inspectRingNavigationFixture(roundTripped);
      if ((inspection.terrainCenterDistance ?? 0) < 40000 ||
          inspection.navigationSurfaceNames.length !== 8 ||
          inspection.solidNames.length !== 0) {
        throw new Error(`The ring fixture did not survive Valve's VMAP conversion: ${JSON.stringify(inspection)}`);
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
        ring,
        animation,
        compileOnly: true,
        inspection: animation
          ? inspectEngineAnimationFixture(roundTripped)
          : ring
          ? inspectRingNavigationFixture(roundTripped)
          : bridge ? inspectBridgeNavigationFixture(roundTripped) : undefined,
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
    if (animation) {
      vc.send("dota_select_hero npc_dota_hero_axe");
      // PRE_GAME (6) can still render Valve's full-screen team showcase. Require
      // GAME_IN_PROGRESS (7) before treating renderer pixels as map evidence.
      const inGameReadiness = await waitForEngineNavigationReady(vc, 7, 120_000);
      if (!inGameReadiness.ready) {
        throw new Error("The animation fixture did not reach GAME_IN_PROGRESS after selecting Axe.");
      }
      const focus = await requestEngineFocus(vc, ENGINE_ANIMATION_FOCUS_TARGET, true, 10_000);
      // Let the camera finish its bounded transition to the named prop before
      // sampling or capturing renderer evidence.
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));

      const clientBefore = await requestEngineAnimationSample(vc, ENGINE_ANIMATION_CLIENT_TARGET, 10_000);
      const serverBefore = await requestEngineAnimationSample(vc, ENGINE_ANIMATION_SERVER_TARGET, 10_000);
      const frameBefore = await captureEngineScreenshot({
        screenshotsDir: dota.screenshotsDir,
        sendCommand: (command) => vc.send(command),
        format: "png",
        timeoutMs: 10_000,
      });
      if (!frameBefore.buf) throw new Error(`First correlated renderer frame failed: ${frameBefore.error || "no PNG returned"}`);

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 900));

      const frameAfter = await captureEngineScreenshot({
        screenshotsDir: dota.screenshotsDir,
        sendCommand: (command) => vc.send(command),
        format: "png",
        timeoutMs: 10_000,
      });
      if (!frameAfter.buf) throw new Error(`Second correlated renderer frame failed: ${frameAfter.error || "no PNG returned"}`);
      const clientAfter = await requestEngineAnimationSample(vc, ENGINE_ANIMATION_CLIENT_TARGET, 10_000);
      const serverAfter = await requestEngineAnimationSample(vc, ENGINE_ANIMATION_SERVER_TARGET, 10_000);

      const clientAssessment = assessEngineAnimationSamples(
        [clientBefore, clientAfter],
        {
          targetName: ENGINE_ANIMATION_CLIENT_TARGET,
          classname: "prop_dynamic",
          model: ENGINE_ANIMATION_MODEL,
          sequence: ENGINE_ANIMATION_SEQUENCE,
          requireCycleProgress: false,
        },
      );
      const serverAssessment = assessEngineAnimationSamples(
        [serverBefore, serverAfter],
        {
          targetName: ENGINE_ANIMATION_SERVER_TARGET,
          classname: "prop_dynamic",
          model: ENGINE_ANIMATION_MODEL,
          sequence: ENGINE_ANIMATION_SEQUENCE,
          requireCycleProgress: true,
        },
      );
      const frameMotion = assessBannerFrameMotion(
        compareAnimationFrames(
          frameBefore.buf,
          frameAfter.buf,
          ENGINE_ANIMATION_FRAME_REGION,
        ),
        {
          minimumWarmEligiblePixels: 6000,
          minimumWarmChangedPixels: 1000,
          minimumWarmChangedFraction: 0.01,
        },
      );
      const consoleErrors = vc.recent(1000)
        .map((line) => line.text)
        .filter((line) => /(script error|stack traceback|assertion failed|lua runtime error|\.lua:\d+:)/i.test(line));
      const issues = [
        ...clientAssessment.issues,
        ...serverAssessment.issues,
        ...frameMotion.issues,
        ...consoleErrors.map((line) => `console: ${line}`),
      ];
      const passed = issues.length === 0;
      console.log(JSON.stringify({
        addonName,
        map: fixtureMap,
        animation: true,
        launch: { method: launch.method, fallbackUsed: launch.fallbackUsed },
        readiness: readiness.line,
        inGameReadiness: inGameReadiness.line,
        focus,
        client: { samples: [clientBefore, clientAfter], assessment: clientAssessment },
        serverProbe: { samples: [serverBefore, serverAfter], assessment: serverAssessment },
        renderer: {
          region: ENGINE_ANIMATION_FRAME_REGION,
          frameBefore: {
            sourcePath: frameBefore.sourcePath,
            dimensions: frameBefore.dimensions,
            correlated: frameBefore.correlated,
            quality: frameBefore.quality,
          },
          frameAfter: {
            sourcePath: frameAfter.sourcePath,
            dimensions: frameAfter.dimensions,
            correlated: frameAfter.correlated,
            quality: frameAfter.quality,
          },
          motion: frameMotion,
        },
        consoleErrors,
        passed,
        issues,
      }, null, 2));
      if (!passed) throw new Error(`Engine animation fixture failed:\n${issues.join("\n")}`);
      return;
    }

    const routes = ring
      ? ringNavigationFixtureRoutesFromText(roundTripped)
      : bridge ? bridgeNavigationFixtureRoutesFromText(roundTripped) : ENGINE_NAV_FIXTURE_ROUTES;
    const execution = await executeEngineNavigationChecks(vc, routes, "both", 10_000);
    const assessment = ring
      ? assessRingNavigationFixture(execution)
      : bridge ? assessBridgeNavigationFixture(execution) : assessEngineNavigationFixture(execution, {
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
      ring,
      animation,
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
