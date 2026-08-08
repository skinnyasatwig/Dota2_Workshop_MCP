import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveProject } from "../config.js";
import {
  assessBannerFrameMotion,
  assessEngineAnimationSamples,
  assessEngineFrame,
  compareAnimationFrames,
  requestEngineAnimationSample,
  requestEngineFrame,
} from "../dota/engine-animation-test.js";
import { ensureEngineNavigationMapReady, waitForEngineNavigationReady } from "../dota/engine-nav-test.js";
import { inspectMapAnimationTarget } from "../dota/map-animation-test.js";
import { captureEngineScreenshot } from "../dota/engine-screenshot.js";
import { attachDebugSdk, DEBUG_SDK_VERSION } from "../dota/debugsdk.js";
import { runOwnedEngineSession } from "../dota/engine-owned-session.js";
import { compileProjectContent, projectMapPaths } from "../dota/map-project.js";
import { inspectProjectMapModels } from "../dota/map-model.js";
import { requireDotaPaths } from "../dota/paths.js";
import { isProcessRunning } from "../dota/process.js";
import { defaultVconPort } from "../dota/vconsole.js";
import { vmapToText } from "../dota/vmap.js";
import { pathExists } from "../util/fsx.js";
import { error, guard, json, ToolResult } from "../util/result.js";

const frameRegionSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
}).strict().refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1, {
  message: "Frame region must remain inside normalized 0..1 image bounds.",
});

const frameSettingsSchema = z.object({
  distance: z.number().finite().min(400).max(5000),
  yaw: z.number().finite().min(-360).max(360),
  pitch: z.number().finite().min(20).max(89),
  heightOffset: z.number().finite().min(-2048).max(2048),
}).strict();

const warmThresholdSchema = z.object({
  minimumWarmEligiblePixels: z.number().int().min(1).max(2_000_000).optional(),
  minimumWarmChangedPixels: z.number().int().min(1).max(2_000_000).optional(),
  minimumWarmChangedFraction: z.number().finite().positive().max(1).optional(),
}).strict();

const DEFAULT_FRAME_REGION = { x: 0.2, y: 0.05, width: 0.6, height: 0.8 } as const;
const DEFAULT_WARM_THRESHOLDS = {
  minimumWarmEligiblePixels: 6000,
  minimumWarmChangedPixels: 1000,
  minimumWarmChangedFraction: 0.01,
} as const;

export function registerMapAnimationTools(server: McpServer) {
  server.registerTool(
    "map_engine_animation_test",
    {
      title: "Verify a named map animation in real Dota",
      description:
        "Dry-run-first, single-launch verification for one exact prop_dynamic. It derives model and sequence from the " +
        "source VMAP, compiles and attaches DebugSDK 1.7 when requested, waits for actual map-render state 7, applies " +
        "bounded deterministic camera framing, samples the exact entity twice, optionally compares two Source 2 PNGs, " +
        "scans console errors, and always shuts down the session it launched.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string().regex(/^[a-z][a-z0-9_]+$/),
        targetName: z.string().regex(/^[A-Za-z0-9_.:-]+$/),
        frame: frameSettingsSchema,
        frameRegion: frameRegionSchema.optional().describe("Normalized PNG region used only by pixelCheck=warm."),
        pixelCheck: z.enum(["none", "warm"]).optional().describe(
          "none proves exact runtime identity/cycle only (default); warm also requires checked warm-colour motion in two PNGs.",
        ),
        warmThresholds: warmThresholdSchema.optional(),
        intervalMs: z.number().int().min(250).max(5000).optional().describe("Delay between samples/frames (default 900ms)."),
        minimumCycleProgress: z.number().finite().positive().max(1).optional().describe("Required forward loop progress (default 0.001)."),
        compile: z.boolean().optional().describe("Compile all addon content, including the camera bridge (default true)."),
        forceCompile: z.boolean().optional(),
        ensureDebugSdk: z.boolean().optional().describe("Attach/update DebugSDK and the Panorama framing bridge (default true)."),
        hero: z.string().regex(/^npc_dota_hero_[a-z0-9_]+$/).optional(),
        readyTimeoutMs: z.number().int().min(1000).max(180000).optional(),
        shutdownTimeoutMs: z.number().int().min(1000).max(60000).optional(),
        replaceRunningDota: z.boolean().optional().describe("Allow closing an existing Dota session (default false)."),
        launchStrategy: z.enum(["auto", "steam", "direct"]).optional(),
        renderer: z.enum(["default", "dx11", "vulkan"]).optional(),
        vconPort: z.number().int().min(1).max(65535).optional(),
        attachFrames: z.boolean().optional().describe("Attach both PNGs to the result when pixelCheck=warm (default false)."),
        dryRun: z.boolean().optional().describe("Return the complete plan without writes, compilation, or launch (default true)."),
      },
    },
    guard(async ({
      projectRoot,
      map,
      targetName,
      frame,
      frameRegion,
      pixelCheck,
      warmThresholds,
      intervalMs,
      minimumCycleProgress,
      compile,
      forceCompile,
      ensureDebugSdk,
      hero,
      readyTimeoutMs,
      shutdownTimeoutMs,
      replaceRunningDota,
      launchStrategy,
      renderer,
      vconPort,
      attachFrames,
      dryRun,
    }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const paths = projectMapPaths(dota, project, map);
      if (!(await pathExists(paths.contentVmap))) return error(`Map not found: ${paths.contentVmap}.`);

      const mapText = await vmapToText(dota.dmxconvertExe, paths.contentVmap);
      const target = inspectMapAnimationTarget(mapText, targetName);
      if (!target.passed || !target.model || !target.sequence || !target.classname) {
        return error(`Animation target preflight failed:\n${target.issues.map((issue) => `- ${issue}`).join("\n")}`);
      }
      const models = await inspectProjectMapModels(mapText, dota, project, false);
      const targetModel = models.models.find((entry) => entry.model.toLowerCase() === target.model!.toLowerCase());
      if (!targetModel || targetModel.state === "missing" || targetModel.state === "invalid") {
        return error(`Animation model is not available to the addon: ${target.model}.`);
      }

      const chosenPixelCheck = pixelCheck ?? "none";
      const chosenRegion = frameRegion ?? DEFAULT_FRAME_REGION;
      const chosenThresholds = { ...DEFAULT_WARM_THRESHOLDS, ...(warmThresholds ?? {}) };
      const sampleInterval = intervalMs ?? 900;
      const cycleMinimum = minimumCycleProgress ?? 0.001;
      const shouldCompile = compile !== false;
      const shouldAttach = ensureDebugSdk !== false;
      const selectedHero = hero ?? "npc_dota_hero_axe";
      const port = vconPort ?? defaultVconPort();
      const isDryRun = dryRun !== false;
      const dotaWasRunning = await isProcessRunning("dota2.exe");
      const framingSettings = { ...frame, hideHero: true };

      if (isDryRun) {
        const sdkPlan = shouldAttach ? await attachDebugSdk(project, true, { cameraBridge: true }) : undefined;
        return json({
          dryRun: true,
          map,
          target,
          targetModel,
          expectedDebugSdkVersion: DEBUG_SDK_VERSION,
          frame: framingSettings,
          pixelCheck: chosenPixelCheck,
          frameRegion: chosenPixelCheck === "warm" ? chosenRegion : undefined,
          warmThresholds: chosenPixelCheck === "warm" ? chosenThresholds : undefined,
          intervalMs: sampleInterval,
          minimumCycleProgress: cycleMinimum,
          compileAllContent: shouldCompile,
          ensureDebugSdkCameraBridge: shouldAttach,
          sdkPlan,
          readyGameState: 7,
          hero: selectedHero,
          dotaWasRunning,
          replaceRunningDota: replaceRunningDota === true,
          launchCount: 1,
          automaticShutdown: true,
        }, [
          `[dry run] ${map}: verify ${targetName} (${target.model}, ${target.sequence}) in one guarded Dota launch.`,
          `Structured cycle proof: required; pixel proof: ${chosenPixelCheck}; deterministic frame: ${JSON.stringify(framingSettings)}.`,
          `Compile: ${shouldCompile}; attach DebugSDK ${DEBUG_SDK_VERSION} + camera bridge: ${shouldAttach}; wait for map state 7; automatic shutdown: yes.`,
          `Dota currently running: ${dotaWasRunning}${dotaWasRunning && !replaceRunningDota ? " (live run would refuse)" : ""}.`,
        ].join("\n"));
      }

      if (dotaWasRunning && replaceRunningDota !== true) {
        return error("Dota is already running. The animation test refused to close it. Exit Dota or explicitly pass replaceRunningDota=true.");
      }
      if (shouldAttach && !shouldCompile) {
        return error("ensureDebugSdk=true needs compile=true so DebugSDK 1.7 and the Panorama framing bridge reach the game.");
      }
      if (!shouldCompile && targetModel.state !== "resolved") {
        return error(`Animation model ${target.model} is only source content; compile before a no-compile live run.`);
      }

      const attached = shouldAttach ? await attachDebugSdk(project, false, { cameraBridge: true }) : undefined;
      if (shouldCompile) {
        const compiled = await compileProjectContent(dota, project, forceCompile === true);
        if (compiled.code !== 0 || compiled.timedOut) {
          return error(`Addon content compilation failed; Dota was not launched.\n${compiled.stdout.slice(-3000)}\n${compiled.stderr.slice(-3000)}`.trim());
        }
      } else if (!(await pathExists(paths.gameVpk)) && !(await pathExists(paths.installedGameVpk))) {
        return error("No compiled map VPK was found. Compile first or pass compile=true; Dota was not launched.");
      }

      let readiness: Awaited<ReturnType<typeof ensureEngineNavigationMapReady>> | undefined;
      let inGameReadiness: Awaited<ReturnType<typeof waitForEngineNavigationReady>> | undefined;
      let framing: Awaited<ReturnType<typeof requestEngineFrame>> | undefined;
      let framingAssessment: ReturnType<typeof assessEngineFrame> | undefined;
      let before: Awaited<ReturnType<typeof requestEngineAnimationSample>> | undefined;
      let after: Awaited<ReturnType<typeof requestEngineAnimationSample>> | undefined;
      let animationAssessment: ReturnType<typeof assessEngineAnimationSamples> | undefined;
      let firstFrame: Awaited<ReturnType<typeof captureEngineScreenshot>> | undefined;
      let secondFrame: Awaited<ReturnType<typeof captureEngineScreenshot>> | undefined;
      let motion: ReturnType<typeof assessBannerFrameMotion> | undefined;
      const session = await runOwnedEngineSession({
        dota,
        addon: project.addonName,
        map,
        port,
        launchStrategy: launchStrategy ?? "auto",
        renderer: renderer === "default" ? undefined : renderer,
        replaceRunningDota: replaceRunningDota === true,
        shutdownTimeoutMs: shutdownTimeoutMs ?? 15_000,
        consoleTailLines: 1000,
      }, async ({ console: vc }) => {
        vc.clearRing();
        readiness = await ensureEngineNavigationMapReady(
          vc,
          project.addonName,
          map,
          3,
          readyTimeoutMs ?? 120_000,
          5000,
        );
        if (!readiness.ready) throw new Error("The map did not reach hero selection before the readiness timeout.");
        if (!readiness.line?.includes(`v=${DEBUG_SDK_VERSION}`)) {
          throw new Error(`Animation verification requires DebugSDK ${DEBUG_SDK_VERSION}; readiness was: ${readiness.line || "silent"}`);
        }
        vc.send(`dota_select_hero ${selectedHero}`);
        inGameReadiness = await waitForEngineNavigationReady(vc, 7, readyTimeoutMs ?? 120_000);
        if (!inGameReadiness.ready) throw new Error("The map did not reach actual map-render state 7 after hero selection.");

        framing = await requestEngineFrame(vc, targetName, framingSettings, 10_000);
        framingAssessment = assessEngineFrame(framing, targetName);
        if (!framingAssessment.passed) {
          throw new Error(`Deterministic camera framing failed before screenshots: ${framingAssessment.issues.join(" ")}`);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));

        before = await requestEngineAnimationSample(vc, targetName, 10_000);
        if (chosenPixelCheck === "warm") {
          firstFrame = await captureEngineScreenshot({
            screenshotsDir: dota.screenshotsDir,
            sendCommand: (command) => vc.send(command),
            format: "png",
            timeoutMs: 10_000,
          });
          if (!firstFrame.buf) throw new Error(`First renderer frame failed: ${firstFrame.error || "no PNG returned"}`);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, sampleInterval));
        if (chosenPixelCheck === "warm") {
          secondFrame = await captureEngineScreenshot({
            screenshotsDir: dota.screenshotsDir,
            sendCommand: (command) => vc.send(command),
            format: "png",
            timeoutMs: 10_000,
          });
          if (!secondFrame.buf) throw new Error(`Second renderer frame failed: ${secondFrame.error || "no PNG returned"}`);
        }
        after = await requestEngineAnimationSample(vc, targetName, 10_000);
        animationAssessment = assessEngineAnimationSamples([before, after], {
          targetName,
          classname: target.classname,
          model: target.model,
          sequence: target.sequence,
          requireCycleProgress: true,
          minimumCycleProgress: cycleMinimum,
        });
        if (firstFrame?.buf && secondFrame?.buf) {
          motion = assessBannerFrameMotion(
            compareAnimationFrames(firstFrame.buf, secondFrame.buf, chosenRegion),
            chosenThresholds,
          );
        }
      });
      const launch = session.launch;
      const fatalError = session.fatalError;
      const shutdown = session.shutdown;
      const consoleErrors = session.consoleTail
        .filter((line) => /(script error|stack traceback|assertion failed|lua runtime error|\.lua:\d+:)/i.test(line));

      const issues = [
        ...(framingAssessment?.issues ?? []),
        ...(animationAssessment?.issues ?? []),
        ...(motion?.issues ?? []),
        ...consoleErrors.map((line) => `console: ${line}`),
        ...(fatalError ? [fatalError] : []),
        ...(!shutdown?.stopped ? ["The launched Dota session did not shut down cleanly."] : []),
      ];
      const passed = issues.length === 0;
      const data = {
        dryRun: false,
        map,
        target,
        targetModel,
        expectedDebugSdkVersion: DEBUG_SDK_VERSION,
        compiled: shouldCompile,
        debugSdk: attached ? { copiedTo: attached.copiedTo, cameraBridge: attached.cameraBridge } : { skipped: true },
        launch,
        windowPreparation: session.windowPreparation,
        startupDiagnosis: session.startupDiagnosis,
        transientStallDismissals: session.transientStallDismissals,
        readiness,
        inGameReadiness,
        framing: framing ? { result: framing, assessment: framingAssessment } : undefined,
        animation: before && after ? { samples: [before, after], assessment: animationAssessment } : undefined,
        renderer: chosenPixelCheck === "warm" ? {
          region: chosenRegion,
          thresholds: chosenThresholds,
          first: firstFrame ? {
            sourcePath: firstFrame.sourcePath,
            dimensions: firstFrame.dimensions,
            correlated: firstFrame.correlated,
            quality: firstFrame.quality,
          } : undefined,
          second: secondFrame ? {
            sourcePath: secondFrame.sourcePath,
            dimensions: secondFrame.dimensions,
            correlated: secondFrame.correlated,
            quality: secondFrame.quality,
          } : undefined,
          motion,
        } : { skipped: true },
        consoleErrors,
        fatalError,
        shutdown,
        issues,
        passed,
      };
      const summary = [
        `${map} ENGINE ANIMATION: ${passed ? "PASSED" : "FAILED"}`,
        `Target: ${targetName}; model: ${target.model}; sequence: ${target.sequence}.`,
        `Structured cycle proof: ${animationAssessment?.passed ? "passed" : "failed or incomplete"}; pixel proof: ` +
          `${chosenPixelCheck === "warm" ? motion?.passed ? "passed" : "failed or incomplete" : "skipped"}.`,
        `Console errors: ${consoleErrors.length}; automatic shutdown: ${shutdown?.stopped ? "complete" : "FAILED"}.`,
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n");
      const result = json(data, summary);
      if (attachFrames === true && chosenPixelCheck === "warm") {
        if (firstFrame?.buf) result.content.push({ type: "image", data: firstFrame.buf.toString("base64"), mimeType: "image/png" });
        if (secondFrame?.buf) result.content.push({ type: "image", data: secondFrame.buf.toString("base64"), mimeType: "image/png" });
      }
      return { ...result, isError: !passed };
    }),
  );
}
