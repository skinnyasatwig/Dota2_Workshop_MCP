import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { resolveProject } from "../config.js";
import { requireDotaPaths } from "../dota/paths.js";
import {
  vmapToText,
  textToVmap,
  cloneVmap,
  maxNodeId,
  buildEntityBlock,
  insertEntity,
  parseMapEntities,
  patchMapEntities,
  rewriteWaypointPath,
  absentSelectorLabel,
  matchesAbsentSelector,
} from "../dota/vmap.js";
import { readAddonInfo, registerMapFile } from "../dota/addoninfo.js";
import { compileProjectMap, projectMapPaths } from "../dota/map-project.js";
import { loadMapContract, managedEntitiesForContract } from "../dota/map-contract.js";
import { inspectMapText } from "../dota/map-inspect.js";
import { reconcileMapTerrain } from "../dota/map-terrain.js";
import { parseMapSpecification, reconcileMapSpecification } from "../dota/map-spec.js";
import { inspectMapArtifactFreshness } from "../dota/map-freshness.js";
import { runMapTransaction } from "../dota/map-transaction.js";
import { analyzeMapReachability } from "../dota/map-reachability.js";
import { resolveMapCollisionObstacles } from "../dota/map-collision.js";
import { reconcileMapVolumes } from "../dota/map-volume.js";
import {
  buildEngineNavigationCommand,
  engineNavigationRoutesFromManagedPaths,
  EngineNavigationExecution,
  EngineNavigationMode,
  EngineNavigationRoute,
  executeEngineNavigationChecks,
  validateEngineNavigationRoutes,
  waitForEngineNavigationReady,
} from "../dota/engine-nav-test.js";
import { attachDebugSdk } from "../dota/debugsdk.js";
import { restartGame, shutdownGame } from "../dota/game-session.js";
import { defaultVconPort, getVConsole } from "../dota/vconsole.js";
import { isProcessRunning } from "../dota/process.js";
import { diagnoseDota } from "../dota/diagnose.js";
import { captureWindowPng } from "../dota/capture.js";
import {
  explainEngineReadiness,
  observeEngineReadiness,
  selectEngineReadinessSignals,
} from "../dota/engine-readiness.js";
import {
  validateDotaBuildingEntities,
  validateDotaNeutralSpawners,
} from "../dota/map-semantics.js";
import {
  FgdValidationReport,
  loadOfficialDotaFgdCatalog,
  validateEntitiesAgainstFgd,
} from "../dota/fgd-validation.js";
import { pathExists } from "../util/fsx.js";
import { json, text, error, guard, ToolResult } from "../util/result.js";

const NAME_RE = /^[a-z][a-z0-9_]+$/;
const numOrStr = z.union([z.string(), z.number()]);

export function registerMapTools(server: McpServer) {
  server.registerTool(
    "map_create",
    {
      title: "Create a playable map",
      description:
        "Create a new, immediately-playable Dota map for the addon by cloning the official template map (which has " +
        "the required ground, lighting and team spawns), then register it in addoninfo.txt. Edit it afterwards with " +
        "map_add_entity / map_from_text, then map_compile. Building bespoke geometry still needs Hammer.",
      inputSchema: {
        projectRoot: z.string().optional(),
        name: z.string().describe("Map name (file/addoninfo name, lowercase)."),
        maxPlayers: z.number().int().min(1).max(24).optional().describe("Per-map MaxPlayers (default 10)."),
        compile: z.boolean().optional().describe("Also compile to a .vpk after creating (default false)."),
        overwrite: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, name, maxPlayers, compile, overwrite }): Promise<ToolResult> => {
      if (!NAME_RE.test(name)) return error(`Invalid map name "${name}" (lowercase letters, digits, underscores).`);
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, name);
      if (!(await pathExists(p.baseTemplate))) return error(`Base template map not found: ${p.baseTemplate}`);
      if ((await pathExists(p.contentVmap)) && !overwrite) return error(`Map already exists: ${p.contentVmap} (pass overwrite=true).`);

      await cloneVmap(p.baseTemplate, p.contentVmap);
      await registerMapFile(p.addoninfo, name, maxPlayers ?? 10);

      const out: Record<string, unknown> = { name, vmap: p.contentVmap, registered: p.addoninfo };
      const steps = [`Created map "${name}":`, `  + ${p.contentVmap}`, `  ~ registered in ${p.addoninfo}`];
      if (compile) {
        const res = await compileProjectMap(dota, project, name);
        out.compiled = res.code === 0;
        steps.push(res.code === 0 ? `  ✓ compiled -> ${p.gameVpk}` : `  ✗ compile failed (exit ${res.code})`);
        if (res.code !== 0) steps.push(res.stdout.slice(-1500));
      } else {
        steps.push(`Next: map_compile name="${name}", then launch with addon_launch_custom_game map="${name}".`);
      }
      return json(out, steps.join("\n"));
    }),
  );

  server.registerTool(
    "map_add_entity",
    {
      title: "Add an entity to a map",
      description:
        "Place an entity (any classname: npc_dota_spawner, info_player_start_*, env_*, point_*, prop_dynamic, …) into " +
        "a map's vmap with origin/angles/properties. Recompile afterwards (or pass recompile=true).",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string().describe("Map name."),
        classname: z.string(),
        origin: z.string().optional().describe('"x y z" (default "0 0 0").'),
        angles: z.string().optional().describe('"pitch yaw roll".'),
        properties: z.record(numOrStr).optional().describe("Entity keyvalues."),
        recompile: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, map, classname, origin, angles, properties, recompile }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}. Create it with map_create.`);

      const txt = await vmapToText(dota.dmxconvertExe, p.contentVmap);
      const block = buildEntityBlock({ classname, origin, angles, properties }, maxNodeId(txt) + 1);
      await textToVmap(dota.dmxconvertExe, insertEntity(txt, block), p.contentVmap);

      const steps = [`Added ${classname} at ${origin ?? "0 0 0"} to "${map}".`];
      if (recompile) {
        const res = await compileProjectMap(dota, project, map);
        steps.push(res.code === 0 ? `Recompiled -> ${p.gameVpk}` : `Recompile FAILED (exit ${res.code})\n${res.stdout.slice(-1500)}`);
      } else {
        steps.push(`Recompile with map_compile name="${map}".`);
      }
      return json({ map, classname }, steps.join("\n"));
    }),
  );

  server.registerTool(
    "map_to_text",
    {
      title: "Read a map as DMX text",
      description: "Return a map's full editable keyvalues2 DMX text (for advanced edits). Pair with map_from_text. Large.",
      inputSchema: { projectRoot: z.string().optional(), map: z.string() },
    },
    guard(async ({ projectRoot, map }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}.`);
      const txt = await vmapToText(dota.dmxconvertExe, p.contentVmap);
      return json({ map, length: txt.length }, txt);
    }),
  );

  server.registerTool(
    "map_inspect",
    {
      title: "Inspect a map as structured data",
      description:
        "Return a compact semantic map report instead of the full DMX text: entity/class counts, filterable named " +
        "entity summaries, linked path_corner/path_track chains, tile-grid bounds/height/water/tilesets, and static " +
        "broken-link or out-of-bounds findings. Does not launch Dota.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        classname: z.string().optional().describe("Return only entities with this exact classname."),
        targetname: z.string().optional().describe("Return only this exact targetname."),
        targetnamePrefix: z.string().optional().describe("Return only targetnames beginning with this prefix."),
        namedOnly: z.boolean().optional().describe("Exclude unnamed entities (default true)."),
        includeProperties: z.boolean().optional().describe("Include all parsed string keyvalues (default false)."),
        includePathNodes: z.boolean().optional().describe("Include every node in each path-chain summary (default false)."),
        checkPathability: z
          .boolean()
          .optional()
          .describe("Sample path chains against tile-grid bounds, water, and terrain height (default true)."),
        pathSampleSpacing: z
          .number()
          .min(16)
          .max(4096)
          .optional()
          .describe("World-unit spacing between terrain samples along paths (default 128)."),
        maxTerrainStep: z
          .number()
          .min(0)
          .optional()
          .describe("Maximum allowed terrain height-level change between route samples (default 1)."),
        maxCellHeightSpan: z
          .number()
          .min(0)
          .optional()
          .describe("Maximum allowed height-level span across one terrain tile (default 1)."),
        limit: z.number().int().min(1).max(1000).optional().describe("Maximum returned entities (default 200)."),
      },
    },
    guard(
      async ({
        projectRoot,
        map,
        classname,
        targetname,
        targetnamePrefix,
        namedOnly,
        includeProperties,
        includePathNodes,
        checkPathability,
        pathSampleSpacing,
        maxTerrainStep,
        maxCellHeightSpan,
        limit,
      }): Promise<ToolResult> => {
        const dota = await requireDotaPaths();
        const project = await resolveProject(projectRoot);
        const p = projectMapPaths(dota, project, map);
        if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}.`);
        const report = inspectMapText(await vmapToText(dota.dmxconvertExe, p.contentVmap), {
          classname,
          targetname,
          targetnamePrefix,
          namedOnly,
          includeProperties,
          includePathNodes,
          checkPathability,
          pathSampleSpacing,
          maxTerrainStep,
          maxCellHeightSpan,
          limit,
        });
        const classSummary = Object.entries(report.classCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 12)
          .map(([name, count]) => `${name}:${count}`)
          .join(", ");
        const pathSummary = report.paths.length
          ? report.paths
              .map((path) => {
                const terrain = path.terrain
                  ? `, terrain=${path.terrain.passable ? "clear" : "warning"}`
                  : "";
                return `${path.start} -> ${path.end} (${path.nodeCount}${path.loop ? ", loop" : ""}${terrain})`;
              })
              .join("\n")
          : "No named path chains.";
        const terrainSummary = report.terrain
          ? `${report.terrain.width}x${report.terrain.height} tiles, ` +
            `world ${report.terrain.worldBounds.min.join(",")} -> ${report.terrain.worldBounds.max.join(",")}`
          : "No Dota tile grid found.";
        return json(
          { map, ...report },
          [
            `${map}: ${report.entityCount} entities (${report.namedEntityCount} named); ` +
              `${report.returnedCount}/${report.matchedCount} filter matches returned.`,
            `Classes: ${classSummary || "none"}`,
            `Terrain: ${terrainSummary}`,
            `Paths:\n${pathSummary}`,
            `Findings: ${report.findings.length}`,
          ].join("\n"),
        );
      },
    ),
  );

  server.registerTool(
    "map_reachability",
    {
      title: "Analyze whole-map terrain reachability",
      description:
        "Offline whole-map pathing preflight using the Dota tile grid. Detects missing terrain recipes, cliff-separated " +
        "regions, trapped spawns, blocked entrances, inaccessible objectives/camps, and small isolated walkable areas. " +
        "Recognizes generated ramp cells, checked player-blocking volumes, and warning-only proximity to explicit Valve " +
        "tree/obstruction classes. It resolves and caches conservative physical hull bounds from real model PHYS blocks " +
        "without substituting render bounds. It does not launch Dota or Hammer; exact hull surfaces, dynamic collision, " +
        "and Valve's final navmesh still require the engine test.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        maxFlatStep: z.number().min(0).optional().describe("Maximum center-height change between normal cells (default 0.25)."),
        maxRampStep: z.number().min(0).optional().describe("Maximum center-height change when a ramp participates (default 0.75)."),
        minRegionCells: z.number().int().min(1).optional().describe("Smaller isolated regions are warned about (default 4)."),
        includeCells: z.boolean().optional().describe("Include every analyzed tile cell (default false; can be large)."),
        resolveModelCollision: z.boolean().optional().describe(
          "Resolve and cache real model PHYS bounds through VRF (default true; no Dota launch).",
        ),
      },
    },
    guard(async ({ projectRoot, map, maxFlatStep, maxRampStep, minRegionCells, includeCells, resolveModelCollision }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}.`);
      const mapText = await vmapToText(dota.dmxconvertExe, p.contentVmap);
      const parsedEntities = parseMapEntities(mapText);
      const collisionObstacles = resolveModelCollision === false
        ? undefined
        : await resolveMapCollisionObstacles(parsedEntities, dota.pak01DirVpk, undefined, {
            compiledModelRoots: [project.gameDir],
            compiledModelVpks: [join(project.gameDir, "pak01_dir.vpk")],
          });
      const report = analyzeMapReachability(mapText, {
        maxFlatStep,
        maxRampStep,
        minRegionCells,
        collisionObstacles,
      });
      const errors = report.findings.filter((finding) => finding.severity === "error").length;
      const warnings = report.findings.length - errors;
      const data = {
        map,
        ...report,
        cells: includeCells ? report.cells : undefined,
      };
      return json(
        data,
        [
          `${map}: ${report.reachableCellCount}/${report.walkableCellCount} walkable cells reachable from spawns; ` +
            `${report.regions.length} region(s).`,
          `Terrain: ${report.cliffCellCount} cliff, ${report.rampCellCount} ramp, ${report.waterCellCount} water, ` +
            `${report.holeCellCount} hole, ${report.volumeBlockedCellCount} volume-blocked, ` +
            `${report.unreachableCellCount} unreachable cells.`,
          `Collision inventory: ${report.physicalBoundsCollisionObstacleCount} PHYS-bound prop(s), ` +
            `${report.approximatedCollisionObstacleCount} known-class approximation(s), ` +
            `${report.unknownBoundsCollisionObstacleCount} solid prop(s) with unknown model bounds; ` +
            `${report.modelCollisionBlockedCellCount} terrain cell(s) conservatively blocked by PHYS bounds.`,
          `Findings: ${errors} error(s), ${warnings} warning(s).`,
          ...report.findings.slice(0, 30).map(
            (finding) => `  [${finding.severity.toUpperCase()}] ${finding.code}: ${finding.targetname} — ${finding.detail}`,
          ),
          ...(report.findings.length > 30 ? [`  ...${report.findings.length - 30} more finding(s)`] : []),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "map_engine_readiness_probe",
    {
      title: "Diagnose whether a map reaches a playable Dota state",
      description:
        "Launch a compiled map once without issuing gameplay or GridNav commands, record the DebugSDK game-state " +
        "timeline, relevant console output, process/window/dialog diagnosis, and a screenshot, then automatically " +
        "close Dota. This is the low-risk diagnostic step to run before map_engine_nav_test. Dry-run is the default.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        compile: z.boolean().optional().describe("Compile the map before launch (default false)."),
        forceCompile: z.boolean().optional().describe("Force the Source 2 compiler to rebuild unchanged inputs."),
        ensureDebugSdk: z
          .boolean()
          .optional()
          .describe("Idempotently attach/update the bundled DebugSDK before launch (default true)."),
        targetGameState: z
          .number()
          .int()
          .min(1)
          .max(9)
          .optional()
          .describe("Game state that counts as ready (default 3, hero selection)."),
        observationMs: z
          .number()
          .int()
          .min(5000)
          .max(180000)
          .optional()
          .describe("Maximum observation window after VConsole connects (default 90000ms)."),
        pollMs: z.number().int().min(250).max(5000).optional().describe("DebugSDK ping interval (default 1000ms)."),
        captureScreenshot: z
          .boolean()
          .optional()
          .describe("Capture the Dota window before shutdown, falling back to background capture (default true)."),
        shutdownTimeoutMs: z.number().int().min(1000).max(60000).optional(),
        replaceRunningDota: z
          .boolean()
          .optional()
          .describe("Allow this tool to close an existing Dota session before its one launch (default false)."),
        launchStrategy: z
          .enum(["auto", "steam", "direct"])
          .optional()
          .describe("Launch transport (default auto)."),
        renderer: z
          .enum(["default", "dx11", "vulkan"])
          .optional()
          .describe("Checked rendering backend override for startup diagnosis (default: Dota's configured renderer)."),
        vconPort: z.number().int().min(1).max(65535).optional(),
        dryRun: z
          .boolean()
          .optional()
          .describe("Return the one-launch diagnostic plan without compiling or launching (default true)."),
      },
    },
    guard(
      async ({
        projectRoot,
        map,
        compile,
        forceCompile,
        ensureDebugSdk,
        targetGameState,
        observationMs,
        pollMs,
        captureScreenshot,
        shutdownTimeoutMs,
        replaceRunningDota,
        launchStrategy,
        renderer,
        vconPort,
        dryRun,
      }): Promise<ToolResult> => {
        const dota = await requireDotaPaths();
        const project = await resolveProject(projectRoot);
        const p = projectMapPaths(dota, project, map);
        if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}.`);

        const shouldCompile = compile === true;
        const shouldAttach = ensureDebugSdk !== false;
        const shouldCapture = captureScreenshot !== false;
        const targetState = targetGameState ?? 3;
        const observeFor = observationMs ?? 90_000;
        const pingEvery = pollMs ?? 1000;
        const port = vconPort ?? defaultVconPort();
        const isDryRun = dryRun !== false;
        const dotaWasRunning = await isProcessRunning("dota2.exe");

        if (isDryRun) {
          return json(
            {
              dryRun: true,
              map,
              compile: shouldCompile,
              ensureDebugSdk: shouldAttach,
              targetGameState: targetState,
              observationMs: observeFor,
              pollMs: pingEvery,
              captureScreenshot: shouldCapture,
              dotaWasRunning,
              replaceRunningDota: replaceRunningDota === true,
              launchCount: 1,
              launchStrategy: launchStrategy ?? "auto",
              renderer: renderer ?? "default",
              gameplayCommands: 0,
              automaticShutdown: true,
            },
            [
              `[dry run] ${map}: one readiness-only Dota launch; no gameplay or navigation commands.`,
              `Observe up to ${observeFor}ms for game state ${targetState}; screenshot: ${shouldCapture ? "yes" : "no"}.`,
              `Compile first: ${shouldCompile}; attach DebugSDK: ${shouldAttach}; automatic shutdown: yes.`,
              `Dota currently running: ${dotaWasRunning}${dotaWasRunning && !replaceRunningDota ? " (actual run would refuse)" : ""}.`,
            ].join("\n"),
          );
        }

        if (dotaWasRunning && replaceRunningDota !== true) {
          return error(
            "Dota is already running. The readiness probe refused to close it. Exit Dota first or explicitly pass replaceRunningDota=true.",
          );
        }
        if (!shouldCompile && !(await pathExists(p.gameVpk)) && !(await pathExists(p.installedGameVpk))) {
          return error("No compiled map VPK was found. Run map_compile or pass compile=true; Dota was not launched.");
        }
        if (shouldCompile) {
          const compileResult = await compileProjectMap(dota, project, map, forceCompile === true);
          if (compileResult.code !== 0) {
            return error(
              `Map compilation failed; Dota was not launched.\n${compileResult.stdout.slice(-3000)}\n${compileResult.stderr.slice(-3000)}`.trim(),
            );
          }
        }

        const attached = shouldAttach ? await attachDebugSdk(project, false) : undefined;
        const vc = getVConsole(port);
        let launchAttempted = false;
        let launched = false;
        let launchResult: Awaited<ReturnType<typeof restartGame>> | undefined;
        let observation: Awaited<ReturnType<typeof observeEngineReadiness>> | undefined;
        let diagnosis: Awaited<ReturnType<typeof diagnoseDota>> | undefined;
        let nextDiagnosisAt = 0;
        let screenshot: Awaited<ReturnType<typeof captureWindowPng>> | undefined;
        let screenshotBuffer: Buffer | undefined;
        let consoleTail: string[] = [];
        let consoleSignals: string[] = [];
        let fatalError: string | undefined;
        let shutdown: Awaited<ReturnType<typeof shutdownGame>> | undefined;

        try {
          launchAttempted = true;
          launchResult = await restartGame(
            dota,
            project.addonName,
            map,
            port,
            true,
            true,
            launchStrategy ?? "auto",
            renderer === "default" ? undefined : renderer,
          );
          launched = true;
          if (!vc.isConnected()) await vc.connectWithRetry(60_000, 1000);
          vc.clearRing();
          observation = await observeEngineReadiness(vc, targetState, observeFor, pingEvery, async () => {
            if (Date.now() < nextDiagnosisAt) return undefined;
            nextDiagnosisAt = Date.now() + 3000;
            try {
              diagnosis = await diagnoseDota();
              if (diagnosis.blocked) {
                const blocker = diagnosis.blockers[0];
                return `Dota is blocked by ${blocker?.role ?? "a dialog"}: ${blocker?.title || blocker?.className || "unknown window"}.`;
              }
            } catch {
              // The final diagnostic pass will report persistent failures.
            }
            return undefined;
          });
        } catch (caught) {
          fatalError = caught instanceof Error ? caught.message : String(caught);
        } finally {
          if (launchAttempted) {
            consoleTail = vc.recent(300).map((line) => line.text);
            consoleSignals = selectEngineReadinessSignals(vc.recent(4000), 240);
            try {
              diagnosis = await diagnoseDota();
            } catch {
              // Window/process diagnosis is best effort; shutdown remains mandatory.
            }
            if (shouldCapture && diagnosis?.running) {
              screenshot = await captureWindowPng("screen", true);
              if (!screenshot.buf) {
                const foregroundError = screenshot.error;
                const fallback = await captureWindowPng("print", false);
                screenshot = fallback.buf
                  ? fallback
                  : { ...fallback, error: [foregroundError, fallback.error].filter(Boolean).join(" | ") };
              }
              screenshotBuffer = screenshot.buf;
            }
            if (launched || diagnosis?.running || (await isProcessRunning("dota2.exe"))) {
              shutdown = await shutdownGame(port, shutdownTimeoutMs ?? 15_000);
            }
          }
        }

        const blocked = diagnosis?.blocked === true;
        const failed =
          !!fatalError ||
          !observation?.ready ||
          blocked ||
          !shutdown?.stopped;
        const explanation = explainEngineReadiness(observation, blocked);
        const screenshotInfo = {
          requested: shouldCapture,
          captured: !!screenshotBuffer,
          mode: screenshot?.mode,
          error: screenshot?.error,
        };
        const data = {
          dryRun: false,
          map,
          compiled: shouldCompile,
          debugSdk: attached
            ? { copiedTo: attached.copiedTo, bootstrapAction: attached.bootstrapAction }
            : { skipped: true },
          launch: launchResult,
          observation,
          explanation,
          consoleSignals,
          consoleTail,
          diagnosis,
          screenshot: screenshotInfo,
          fatalError,
          shutdown,
          passed: !failed,
        };
        const timeline = observation?.timeline.length
          ? observation.timeline.map(
              (sample) =>
                `  +${sample.elapsedMs}ms: state=${sample.state}${sample.gameTime === undefined ? "" : ` gameTime=${sample.gameTime}`}`,
            )
          : ["  (no DebugSDK state samples)"];
        const output = [
          `${map} ENGINE READINESS: ${failed ? "NOT READY" : "READY"}`,
          explanation,
          `Pings: ${observation?.pongCount ?? 0}; highest state: ${observation?.highestState ?? "none"}; target: ${targetState}.`,
          "State timeline:",
          ...timeline,
          `Blocking dialog: ${blocked ? "YES" : "no"}; screenshot: ${screenshotBuffer ? `captured (${screenshot?.mode})` : shouldCapture ? "failed" : "skipped"}.`,
          `Automatic shutdown: ${shutdown?.stopped ? "complete" : "FAILED"}.`,
          ...(fatalError ? [`Fatal: ${fatalError}`] : []),
          ...(diagnosis?.summary ? ["Window diagnosis:", diagnosis.summary] : []),
          ...(screenshot?.error ? [`Screenshot note: ${screenshot.error}`] : []),
          ...(shutdown ? [`Shutdown: ${shutdown.detail}`] : []),
        ].join("\n");
        const result = json(data, output);
        if (screenshotBuffer) {
          result.content.push({ type: "image", data: screenshotBuffer.toString("base64"), mimeType: "image/png" });
        }
        return { ...result, isError: failed };
      },
    ),
  );

  server.registerTool(
    "map_engine_nav_test",
    {
      title: "Test map routes with Dota's real navigation",
      description:
        "Compile and launch a map exactly once, test specification paths with Valve's real GridNav API, return " +
        "route/segment/path-length results, then automatically close Dota. Refuses to replace an already-running " +
        "Dota session unless replaceRunningDota=true. Dry-run is the default; pass dryRun=false for the engine test.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        contractFile: z
          .string()
          .optional()
          .describe("Unified map specification path. Defaults to .dota-workshop/map-contract.json."),
        routes: z
          .array(
            z.object({
              name: z.string().min(1),
              points: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2).max(128),
            }),
          )
          .min(1)
          .max(64)
          .optional()
          .describe("Explicit routes; otherwise every managedPath in the unified specification is tested."),
        mode: z
          .enum(["endpoints", "segments", "both"])
          .optional()
          .describe("Check each full route, each consecutive segment, or both (default both)."),
        compile: z.boolean().optional().describe("Compile the map before launch (default true)."),
        forceCompile: z.boolean().optional().describe("Force the Source 2 compiler to rebuild unchanged inputs."),
        ensureDebugSdk: z
          .boolean()
          .optional()
          .describe("Idempotently attach/update the bundled DebugSDK before launch (default true)."),
        readyGameState: z
          .number()
          .int()
          .min(1)
          .max(9)
          .optional()
          .describe("Minimum Dota game state before testing (default 3, hero selection)."),
        readyTimeoutMs: z.number().int().min(1000).max(180000).optional(),
        routeTimeoutMs: z.number().int().min(1000).max(60000).optional(),
        errorWindowMs: z.number().int().min(0).max(60000).optional(),
        shutdownTimeoutMs: z.number().int().min(1000).max(60000).optional(),
        replaceRunningDota: z
          .boolean()
          .optional()
          .describe("Allow this tool to close an existing Dota session before its one launch (default false)."),
        launchStrategy: z
          .enum(["auto", "steam", "direct"])
          .optional()
          .describe("Launch transport (default auto: Steam, then direct only if Steam creates no Dota process)."),
        renderer: z
          .enum(["default", "dx11", "vulkan"])
          .optional()
          .describe("Checked rendering backend override (default: Dota's configured renderer)."),
        vconPort: z.number().int().min(1).max(65535).optional(),
        dryRun: z
          .boolean()
          .optional()
          .describe("Return the bounded launch/check/shutdown plan without compiling or launching (default true)."),
      },
    },
    guard(
      async ({
        projectRoot,
        map,
        contractFile,
        routes,
        mode,
        compile,
        forceCompile,
        ensureDebugSdk,
        readyGameState,
        readyTimeoutMs,
        routeTimeoutMs,
        errorWindowMs,
        shutdownTimeoutMs,
        replaceRunningDota,
        launchStrategy,
        renderer,
        vconPort,
        dryRun,
      }): Promise<ToolResult> => {
        const dota = await requireDotaPaths();
        const project = await resolveProject(projectRoot);
        const p = projectMapPaths(dota, project, map);
        if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}.`);

        let chosenRoutes: EngineNavigationRoute[];
        let routeSource: string;
        if (routes) {
          chosenRoutes = validateEngineNavigationRoutes(routes as EngineNavigationRoute[]);
          routeSource = "explicit routes";
        } else {
          const resolved = await loadMapContract(project.root, map, contractFile, parseMapSpecification);
          if (!resolved) {
            return error(
              "No unified map specification was found. Add managedPaths, pass contractFile, or provide explicit routes.",
            );
          }
          if (!resolved.contract.managedPaths?.length) {
            return error(`Unified map specification has no managedPaths: ${resolved.path}`);
          }
          chosenRoutes = engineNavigationRoutesFromManagedPaths(resolved.contract.managedPaths);
          routeSource = resolved.path;
        }

        const chosenMode = (mode ?? "both") as EngineNavigationMode;
        const pointCount = chosenRoutes.reduce((sum, route) => sum + route.points.length, 0);
        const checkCount = chosenRoutes.reduce(
          (sum, route) =>
            sum +
            (chosenMode === "segments" ? 0 : 1) +
            (chosenMode === "endpoints" ? 0 : route.points.length - 1),
          0,
        );
        const commands = chosenRoutes.map((route) => buildEngineNavigationCommand(route, chosenMode));
        const dotaWasRunning = await isProcessRunning("dota2.exe");
        const shouldCompile = compile !== false;
        const shouldAttach = ensureDebugSdk !== false;
        const isDryRun = dryRun !== false;
        const port = vconPort ?? defaultVconPort();

        if (isDryRun) {
          return json(
            {
              dryRun: true,
              map,
              routeSource,
              routeCount: chosenRoutes.length,
              pointCount,
              checkCount,
              mode: chosenMode,
              compile: shouldCompile,
              ensureDebugSdk: shouldAttach,
              dotaWasRunning,
              replaceRunningDota: replaceRunningDota === true,
              launchCount: 1,
              launchStrategy: launchStrategy ?? "auto",
              renderer: renderer ?? "default",
              automaticShutdown: true,
              commandBytes: commands.map((command) => command.length),
            },
            [
              `[dry run] ${map}: ${chosenRoutes.length} route(s), ${pointCount} points, ${checkCount} GridNav checks.`,
              `Routes: ${routeSource}`,
              `Compile first: ${shouldCompile}; attach DebugSDK: ${shouldAttach}; launch count: 1; automatic shutdown: yes.`,
              `Dota currently running: ${dotaWasRunning}${dotaWasRunning && !replaceRunningDota ? " (actual run would refuse)" : ""}.`,
            ].join("\n"),
          );
        }

        if (dotaWasRunning && replaceRunningDota !== true) {
          return error(
            "Dota is already running. The engine navigation test refused to close it. Exit Dota first or explicitly pass replaceRunningDota=true.",
          );
        }

        if (shouldCompile) {
          const compileResult = await compileProjectMap(dota, project, map, forceCompile === true);
          if (compileResult.code !== 0) {
            return error(
              `Map compilation failed; Dota was not launched.\n${compileResult.stdout.slice(-3000)}\n${compileResult.stderr.slice(-3000)}`.trim(),
            );
          }
        }

        const attached = shouldAttach ? await attachDebugSdk(project, false) : undefined;
        const vc = getVConsole(port);
        let launched = false;
        let launchResult: Awaited<ReturnType<typeof restartGame>> | undefined;
        let execution: EngineNavigationExecution = { results: [], failures: [] };
        let fatalError: string | undefined;
        let readyLine: string | undefined;
        let readiness: Awaited<ReturnType<typeof waitForEngineNavigationReady>> | undefined;
        let consoleErrors: string[] = [];
        let consoleTail: string[] = [];
        let preShutdownDiagnosis: Awaited<ReturnType<typeof diagnoseDota>> | undefined;
        let shutdown: Awaited<ReturnType<typeof shutdownGame>> | undefined;

        try {
          launchResult = await restartGame(
            dota,
            project.addonName,
            map,
            port,
            true,
            true,
            launchStrategy ?? "auto",
            renderer === "default" ? undefined : renderer,
          );
          launched = true;
          if (!vc.isConnected()) await vc.connectWithRetry(60_000, 1000);
          vc.clearRing();
          const ready = await waitForEngineNavigationReady(
            vc,
            readyGameState ?? 3,
            readyTimeoutMs ?? 120_000,
          );
          readiness = ready;
          if (!ready.ready) {
            fatalError = `Map did not reach Dota game state ${readyGameState ?? 3} before the timeout.`;
          } else {
            readyLine = ready.line;
            execution = await executeEngineNavigationChecks(
              vc,
              chosenRoutes,
              chosenMode,
              routeTimeoutMs ?? 10_000,
            );
            const watchMs = errorWindowMs ?? 2000;
            if (watchMs > 0) await new Promise((resolve) => setTimeout(resolve, watchMs));
            const engineError =
              /(script error|stack traceback|attempt to (call|index|perform|concatenate)|assertion failed|lua runtime error|[^A-Za-z]Error:|\.lua:\d+:)/i;
            consoleErrors = vc
              .recent(2000)
              .filter((line) => engineError.test(line.text))
              .map((line) => line.text);
          }
        } catch (caught) {
          fatalError = caught instanceof Error ? caught.message : String(caught);
        } finally {
          if (launched && fatalError) {
            consoleTail = vc.recent(200).map((line) => line.text);
            try {
              preShutdownDiagnosis = await diagnoseDota();
            } catch {
              // Readiness diagnostics are best effort; shutdown is mandatory.
            }
          }
          if (launched) shutdown = await shutdownGame(port, shutdownTimeoutMs ?? 15_000);
        }

        const failedRouteResults = execution.results.filter((result) => !result.passed);
        const failedChecks = execution.results.reduce(
          (sum, result) =>
            sum +
            (result.endpoint && !result.endpoint.passed && chosenMode !== "segments" ? 1 : 0) +
            result.segments.filter((segment) => !segment.passed).length,
          0,
        );
        const failed =
          !!fatalError ||
          execution.failures.length > 0 ||
          failedRouteResults.length > 0 ||
          consoleErrors.length > 0 ||
          !shutdown?.stopped;
        const data = {
          dryRun: false,
          map,
          routeSource,
          routeCount: chosenRoutes.length,
          pointCount,
          checkCount,
          mode: chosenMode,
          compiled: shouldCompile,
          debugSdk: attached
            ? { copiedTo: attached.copiedTo, bootstrapAction: attached.bootstrapAction }
            : { skipped: true },
          launch: launchResult,
          readyLine,
          readiness,
          results: execution.results,
          executionFailures: execution.failures,
          failedRouteCount: failedRouteResults.length,
          failedChecks,
          consoleErrors,
          consoleTail,
          preShutdownDiagnosis,
          fatalError,
          shutdown,
          passed: !failed,
        };
        const output = [
          `${map} ENGINE NAV: ${failed ? "FAILED" : "PASSED"}`,
          `${execution.results.length}/${chosenRoutes.length} route responses; ${failedRouteResults.length} failed route(s), ${failedChecks} failed check(s).`,
          `Console errors: ${consoleErrors.length}; automatic shutdown: ${shutdown?.stopped ? "complete" : "FAILED"}.`,
          ...(fatalError ? [`Fatal: ${fatalError}`] : []),
          ...execution.failures.map((failure) => `  [ERROR] ${failure.name}: ${failure.error}`),
          ...failedRouteResults.map((result) => `  [BLOCKED] ${result.name}`),
          ...(shutdown ? [`Shutdown: ${shutdown.detail}`] : []),
        ].join("\n");
        return { ...json(data, output), isError: failed };
      },
    ),
  );

  server.registerTool(
    "map_patch_entities",
    {
      title: "Patch existing map entities",
      description:
        "Batch-update entities selected by targetname without rebuilding the map: change classname/targetname, move or " +
        "rotate them, add/replace string keyvalues, or remove keyvalues. Unmatched selectors abort the write by default. " +
        "Use this to turn layout markers into real towers, spawners, forts, triggers, and other gameplay entities.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        patches: z.array(
          z.object({
            targetname: z.string(),
            classname: z.string().optional(),
            newTargetname: z.string().optional(),
            origin: z.string().optional(),
            angles: z.string().optional(),
            properties: z.record(numOrStr).optional(),
            removeProperties: z.array(z.string()).optional(),
          }),
        ),
        strict: z.boolean().optional().describe("Abort without writing if any targetname is missing (default true)."),
        recompile: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, map, patches, strict, recompile }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}.`);

      const current = await vmapToText(dota.dmxconvertExe, p.contentVmap);
      const result = patchMapEntities(current, patches);
      if (strict !== false && result.unmatched.length) {
        return error(`No changes written. Missing targetnames: ${result.unmatched.join(", ")}`);
      }
      await textToVmap(dota.dmxconvertExe, result.text, p.contentVmap);

      const steps = [
        `Patched ${result.matched.length} entities in "${map}".`,
        result.unmatched.length ? `Unmatched: ${result.unmatched.join(", ")}` : "All selectors matched.",
      ];
      if (recompile) {
        const res = await compileProjectMap(dota, project, map);
        steps.push(res.code === 0 ? `Recompiled -> ${p.installedGameVpk}` : `Recompile FAILED (exit ${res.code})`);
      }
      return json(
        { map, matched: result.matched, unmatched: result.unmatched, recompiled: !!recompile },
        steps.join("\n"),
      );
    }),
  );

  server.registerTool(
    "map_sync_contract",
    {
      title: "Synchronize a map with its managed contract",
      description:
        "Preview or apply desired managedEntities, managedAbsentEntities, compact managedPaths, managedTerrain, and " +
        "checked managedVolumes " +
        "operations from " +
        ".dota-workshop/map-contract.json. Reusable regions/components/placements are expanded before reconciliation. " +
        "Paths expand into complete linked waypoint chains. Missing named entities " +
        "are created; existing named entities are repaired; obsolete managed path nodes are removed; and declared " +
        "terrain shapes are restored while terrain outside those shapes is preserved. The operation is idempotent and " +
        "refuses ambiguous duplicate targetnames. Defaults to preview-only; pass apply=true.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        contractFile: z
          .string()
          .optional()
          .describe("JSON contract path. Defaults to .dota-workshop/map-contract.json."),
        apply: z.boolean().optional().describe("Write the planned changes (default false)."),
        recompile: z.boolean().optional().describe("Compile after applying (default false)."),
      },
    },
    guard(async ({ projectRoot, map, contractFile, apply, recompile }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}.`);
      if (recompile && !apply) return error("recompile=true requires apply=true; preview mode never compiles or writes files.");
      const resolved = await loadMapContract(project.root, map, contractFile, parseMapSpecification);
      if (!resolved) return error(`Map contract not found under ${project.root}.`);
      const specs = managedEntitiesForContract(resolved.contract);
      const absentEntities = resolved.contract.managedAbsentEntities ?? [];
      const terrainOperations = resolved.contract.managedTerrain ?? [];
      const volumeSpecifications = resolved.contract.managedVolumes ?? [];
      if (!specs.length && !absentEntities.length && !terrainOperations.length && !volumeSpecifications.length) {
        return error(
          `Contract has no managedEntities, managedAbsentEntities, managedPaths, managedTerrain, or managedVolumes to synchronize: ${resolved.path}`,
        );
      }

      const current = await vmapToText(dota.dmxconvertExe, p.contentVmap);
      const synchronization = reconcileMapSpecification(current, resolved.contract);
      const result = synchronization.entities;
      if (result.conflicts.length) {
        return error(
          `No changes written. Duplicate targetnames make these managed entities ambiguous: ${result.conflicts.join(", ")}`,
        );
      }

      const terrain = synchronization.terrain;
      const volumes = synchronization.volumes;
      const changedEntities = result.added.length + result.updated.length + result.removed.length;
      const changedVolumes = volumes.added.length + volumes.updated.length;
      const changed = changedEntities + changedVolumes + (terrain.changed ? 1 : 0);
      const transaction = apply && (changed > 0 || recompile)
        ? await runMapTransaction({
            projectRoot: project.root,
            label: `${map}-contract-sync`,
            trackedPaths: [p.contentVmap, ...(recompile ? [p.gameVpk] : [])],
            action: async () => {
              if (changed > 0) await textToVmap(dota.dmxconvertExe, synchronization.text, p.contentVmap);
              if (recompile) {
                const res = await compileProjectMap(dota, project, map);
                const compiled = res.code === 0 && (await pathExists(p.installedGameVpk));
                if (!compiled) {
                  throw new Error(
                    `Compilation failed (exit ${res.code ?? "unknown"}).\n${(res.stderr || res.stdout).slice(-1600)}`,
                  );
                }
              }
              return { recompiled: recompile === true };
            },
          })
        : undefined;
      if (transaction && !transaction.committed) {
        const failure = json(
          {
            map,
            contract: resolved.path,
            applied: false,
            rolledBack: transaction.rolledBack,
            backupDirectory: transaction.backupDirectory,
            error: transaction.error,
            rollbackErrors: transaction.rollbackErrors,
          },
          `Contract synchronization failed and ${transaction.rolledBack ? "was rolled back safely" : "the rollback needs attention"}.\n` +
            `Backup: ${transaction.backupDirectory}\n${transaction.error ?? "Unknown transaction failure."}`,
        );
        failure.isError = true;
        return failure;
      }
      const steps = [
        `${apply ? "Synchronized" : "Previewed"} ${specs.length} desired entities and ` +
          `${absentEntities.length} absence selectors plus ${volumeSpecifications.length} solid volumes in "${map}".`,
        `Add ${result.added.length}, update ${result.updated.length}, remove ${result.removed.length}, ` +
          `unchanged ${result.unchanged.length}.`,
        `Volumes: add ${volumes.added.length}, update ${volumes.updated.length}, unchanged ${volumes.unchanged.length}.`,
        `Terrain: ${terrainOperations.length} operations; change ${terrain.changedHeightVertices} height vertices, ` +
          `${terrain.changedWaterVertices} water vertices, ${terrain.changedTilesetCells} tileset cells, and ` +
          `${terrain.changedOrientationCells} orientation cells, and ` +
          `${terrain.changedConfigurationCells} tile recipes plus ${terrain.changedPathEdges} path edges.`,
      ];
      if (!apply && changed) steps.push("No files changed. Pass apply=true to write this plan.");
      if (apply && recompile) steps.push(`Recompiled -> ${p.installedGameVpk}`);
      if (transaction) steps.push(`Recovery backup -> ${transaction.backupDirectory}`);
      return json(
        {
          map,
          contract: resolved.path,
          applied: apply === true,
          changed,
          changedEntities,
          changedVolumes,
          added: result.added,
          updated: result.updated,
          removed: result.removed,
          unchanged: result.unchanged,
          volumes: {
            requested: volumeSpecifications.length,
            added: volumes.added,
            updated: volumes.updated,
            unchanged: volumes.unchanged,
          },
          terrain: {
            changed: terrain.changed,
            changedHeightVertices: terrain.changedHeightVertices,
            changedWaterVertices: terrain.changedWaterVertices,
            changedTilesetCells: terrain.changedTilesetCells,
            changedOrientationCells: terrain.changedOrientationCells,
            changedConfigurationCells: terrain.changedConfigurationCells,
            changedPathEdges: terrain.changedPathEdges,
            operations: terrain.operations,
          },
          recompiled: apply === true && recompile === true,
          backupDirectory: transaction?.backupDirectory,
          rolledBack: false,
        },
        steps.join("\n"),
      );
    }),
  );

  server.registerTool(
    "map_rewrite_path",
    {
      title: "Rewrite a waypoint chain",
      description:
        "Convert and consistently rename every numerically suffixed waypoint in an existing chain. Updates classname, " +
        "targetname, and target links together and removes path_track-only properties. Useful for converting generated " +
        "path_track routes into Dota creep path_corner chains.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        fromPrefix: z.string().describe("Existing prefix before the numeric suffix, e.g. radiant_north_route_."),
        toPrefix: z.string().describe("New prefix, e.g. path_radiant_north_."),
        classname: z.string().optional().describe("New entity class (default path_corner)."),
        startIndex: z.number().int().min(0).optional().describe("First numeric suffix (default 1)."),
        recompile: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, map, fromPrefix, toPrefix, classname, startIndex, recompile }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      if (!(await pathExists(p.contentVmap))) return error(`Map not found: ${p.contentVmap}.`);

      const current = await vmapToText(dota.dmxconvertExe, p.contentVmap);
      const result = rewriteWaypointPath(current, fromPrefix, toPrefix, classname ?? "path_corner", startIndex ?? 1);
      if (!result.matched.length) return error(`No numerically suffixed waypoints found with prefix "${fromPrefix}".`);
      await textToVmap(dota.dmxconvertExe, result.text, p.contentVmap);

      const steps = [`Rewrote ${result.matched.length} waypoints: ${fromPrefix}* -> ${toPrefix}${startIndex ?? 1}...`];
      if (recompile) {
        const res = await compileProjectMap(dota, project, map);
        steps.push(res.code === 0 ? `Recompiled -> ${p.installedGameVpk}` : `Recompile FAILED (exit ${res.code})`);
      }
      return json({ map, count: result.matched.length, fromPrefix, toPrefix }, steps.join("\n"));
    }),
  );

  server.registerTool(
    "map_from_text",
    {
      title: "Write a map from DMX text",
      description:
        "Write a map's binary .vmap from keyvalues2 DMX text (full programmatic control). The text must be a valid " +
        "vmap DMX document (e.g. obtained via map_to_text and edited). Recompile afterwards.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        text: z.string().describe("keyvalues2 DMX vmap text (must start with the dmx header)."),
        recompile: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, map, text: dmxText, recompile }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      await textToVmap(dota.dmxconvertExe, dmxText, p.contentVmap);
      const steps = [`Wrote ${p.contentVmap} (${dmxText.length} chars).`];
      if (recompile) {
        const res = await compileProjectMap(dota, project, map);
        steps.push(res.code === 0 ? `Recompiled -> ${p.gameVpk}` : `Recompile FAILED (exit ${res.code})\n${res.stdout.slice(-1500)}`);
      }
      return json({ map }, steps.join("\n"));
    }),
  );

  server.registerTool(
    "map_compile",
    {
      title: "Compile a map",
      description: "Compile a map's content .vmap into a playable game .vpk (resourcecompiler).",
      inputSchema: {
        projectRoot: z.string().optional(),
        name: z.string(),
        force: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, name, force, dryRun }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, name);
      if (dryRun) return text(`[dry run]\n"${dota.resourceCompilerExe}" -v -nop4${force ? " -f" : ""} -i "${p.installedContentVmap}" -game "${dota.dotaGameDir}"`);
      if (!(await pathExists(p.contentVmap))) return error(`Map content not found: ${p.contentVmap}.`);
      const res = await compileProjectMap(dota, project, name, force);
      const ok = res.code === 0 && (await pathExists(p.installedGameVpk));
      return json(
        { name, ok, vpk: p.installedGameVpk, exitCode: res.code },
        `${ok ? "COMPILE OK -> " + p.installedGameVpk : "COMPILE FAILED (exit " + res.code + ")"}\n\n${res.stdout.slice(-2000)}\n${res.stderr.slice(-500)}`.trim(),
      );
    }),
  );

  server.registerTool(
    "map_list",
    {
      title: "List addon maps",
      description:
        "List the addon's maps (from addoninfo.txt) with source (.vmap), compiled (.vpk), and compiled-freshness status.",
      inputSchema: { projectRoot: z.string().optional() },
    },
    guard(async ({ projectRoot }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const addoninfo = projectMapPaths(dota, project, "_probe").addoninfo;
      let names: string[] = [];
      if (await pathExists(addoninfo)) {
        names = (await readAddonInfo(addoninfo)).maps;
      }
      const maps = [];
      for (const name of names) {
        const p = projectMapPaths(dota, project, name);
        const [source, compiled] = await Promise.all([
          pathExists(p.contentVmap),
          pathExists(p.gameVpk),
        ]);
        const freshness =
          source && compiled
            ? await inspectMapArtifactFreshness(p.contentVmap, p.gameVpk)
            : undefined;
        maps.push({
          name,
          source,
          compiled,
          compiledFresh: freshness?.fresh ?? null,
        });
      }
      return json(
        { count: maps.length, maps },
        maps.length
          ? maps
              .map(
                (m) =>
                  `  ${m.name}  [source: ${m.source ? "yes" : "no"}, ` +
                  `compiled: ${!m.compiled ? "no" : m.compiledFresh ? "yes, fresh" : "yes, stale"}]`,
              )
              .join("\n")
          : "No maps registered in addoninfo.txt.",
      );
    }),
  );

  server.registerTool(
    "map_validate",
    {
      title: "Validate a map and its script contract",
      description:
        "Static preflight for autonomous map work (does not launch Dota): checks source/registration/compiled presence " +
        "and whether the compiled VPK is older than its VMAP source, " +
        "extracts entities, finds duplicate targetnames and broken path_corner/path_track links, and verifies required " +
        "targetname/classname pairs used by game scripts. When a project contract declares managedTerrain or " +
        "managedVolumes, validation also reports tile-grid or checked-volume drift without writing it. Whole-map " +
        "offline reachability checks detect terrain holes, " +
        "trapped spawns, blocked entrances/path segments, and inaccessible objectives or camps. Known entity keyvalues " +
        "are checked against the installed official Valve FGD definitions.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        requiredEntities: z
          .array(
            z.object({
              targetname: z.string(),
              classname: z.string().optional(),
              origin: z.string().optional(),
              angles: z.string().optional(),
              properties: z.record(numOrStr).optional(),
              absentProperties: z.array(z.string()).optional(),
            }),
          )
          .optional()
          .describe("Script contract, e.g. [{targetname:'radiant_t1'}, {targetname:'path_radiant_north_1', classname:'path_corner'}]."),
        contractFile: z
          .string()
          .optional()
          .describe("JSON contract path. Defaults to .dota-workshop/map-contract.json when present."),
        requireCompiled: z
          .boolean()
          .optional()
          .describe("Treat a missing or stale compiled VPK as an error (default false)."),
        strictEntityProperties: z
          .boolean()
          .optional()
          .describe("Also warn for classes/properties absent from Valve's installed FGD files (default false; custom metadata is otherwise informational)."),
      },
    },
    guard(async ({ projectRoot, map, requiredEntities, contractFile, requireCompiled, strictEntityProperties }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      const findings: { severity: "error" | "warn"; code: string; message: string }[] = [];
      const resolvedContract = requiredEntities
        ? undefined
        : await loadMapContract(project.root, map, contractFile, parseMapSpecification);
      const managedContractEntities = resolvedContract
        ? managedEntitiesForContract(resolvedContract.contract)
        : [];
      const contractRequirements = resolvedContract
        ? [
            ...resolvedContract.contract.requiredEntities,
            ...managedContractEntities.map((managed) => ({
              targetname: managed.targetname,
              classname: managed.classname,
              origin: managed.origin,
              angles: managed.angles,
              properties: managed.properties,
              absentProperties: managed.removeProperties,
            })),
          ]
        : [];
      const requirements = requiredEntities
        ? requiredEntities
        : [...new Map(contractRequirements.map((requirement) => [requirement.targetname, requirement])).values()];

      const source = await pathExists(p.contentVmap);
      const compiled = await pathExists(p.gameVpk);
      const compiledFreshness =
        source && compiled ? await inspectMapArtifactFreshness(p.contentVmap, p.gameVpk) : undefined;
      if (!source) {
        findings.push({ severity: "error", code: "source-missing", message: `Map source not found: ${p.contentVmap}` });
      }

      let registered = false;
      if (await pathExists(p.addoninfo)) {
        registered = (await readAddonInfo(p.addoninfo)).maps.includes(map);
      }
      if (!registered) {
        findings.push({ severity: "error", code: "not-registered", message: `"${map}" is not registered in ${p.addoninfo}` });
      }
      if (!compiled) {
        findings.push({
          severity: requireCompiled ? "error" : "warn",
          code: "compiled-missing",
          message: `Compiled map not found: ${p.gameVpk}`,
        });
      } else if (compiledFreshness && !compiledFreshness.fresh) {
        findings.push({
          severity: requireCompiled ? "error" : "warn",
          code: "compiled-stale",
          message:
            `Compiled map is older than its source by ` +
            `${Math.ceil(Math.abs(compiledFreshness.ageDeltaMs) / 1000)} second(s): ${p.gameVpk}`,
        });
      }

      let entities: ReturnType<typeof parseMapEntities> = [];
      let entityDefinitionValidation: FgdValidationReport | undefined;
      let terrainDrift:
        | {
            changedHeightVertices: number;
            changedWaterVertices: number;
            changedTilesetCells: number;
            changedOrientationCells: number;
            changedConfigurationCells: number;
            changedPathEdges: number;
          }
        | undefined;
      let volumeDrift:
        | {
            missing: string[];
            changed: string[];
            unchanged: string[];
          }
        | undefined;
      let reachabilitySummary:
        | {
            walkableCellCount: number;
            reachableCellCount: number;
            unreachableCellCount: number;
            blockedCellCount: number;
            volumeBlockedCellCount: number;
            collisionObstacleCount: number;
            physicalBoundsCollisionObstacleCount: number;
            approximatedCollisionObstacleCount: number;
            unknownBoundsCollisionObstacleCount: number;
            modelCollisionBlockedCellCount: number;
            cliffCellCount: number;
            rampCellCount: number;
            holeCellCount: number;
            regionCount: number;
            findingCount: number;
          }
        | undefined;
      if (source) {
        const mapText = await vmapToText(dota.dmxconvertExe, p.contentVmap);
        entities = parseMapEntities(mapText);
        entityDefinitionValidation = validateEntitiesAgainstFgd(
          entities,
          await loadOfficialDotaFgdCatalog(dota.dotaGameDir),
          { strictUnknown: strictEntityProperties === true },
        );
        for (const finding of entityDefinitionValidation.findings) {
          findings.push({
            severity: finding.severity,
            code: finding.code,
            message: `${finding.targetname || finding.classname}: ${finding.detail}`,
          });
        }
        findings.push(...validateDotaBuildingEntities(entities));
        findings.push(...validateDotaNeutralSpawners(entities));
        const geometryReport = inspectMapText(mapText, {
          namedOnly: false,
          includePathNodes: false,
          checkPathability: true,
          pathSampleSpacing: 128,
          maxTerrainStep: 1,
          maxCellHeightSpan: 1,
          limit: 1,
        });
        for (const finding of geometryReport.findings) {
          if (finding.code === "broken-path-target") continue;
          findings.push({
            severity: "error",
            code: finding.code,
            message: `${finding.targetname}: ${finding.detail}`,
          });
        }
        const reachability = analyzeMapReachability(mapText, {
          collisionObstacles: await resolveMapCollisionObstacles(
            entities,
            dota.pak01DirVpk,
            undefined,
            {
              compiledModelRoots: [project.gameDir],
              compiledModelVpks: [join(project.gameDir, "pak01_dir.vpk")],
            },
          ),
        });
        reachabilitySummary = {
          walkableCellCount: reachability.walkableCellCount,
          reachableCellCount: reachability.reachableCellCount,
          unreachableCellCount: reachability.unreachableCellCount,
          blockedCellCount: reachability.blockedCellCount,
          volumeBlockedCellCount: reachability.volumeBlockedCellCount,
          collisionObstacleCount: reachability.collisionObstacleCount,
          physicalBoundsCollisionObstacleCount: reachability.physicalBoundsCollisionObstacleCount,
          approximatedCollisionObstacleCount: reachability.approximatedCollisionObstacleCount,
          unknownBoundsCollisionObstacleCount: reachability.unknownBoundsCollisionObstacleCount,
          modelCollisionBlockedCellCount: reachability.modelCollisionBlockedCellCount,
          cliffCellCount: reachability.cliffCellCount,
          rampCellCount: reachability.rampCellCount,
          holeCellCount: reachability.holeCellCount,
          regionCount: reachability.regions.length,
          findingCount: reachability.findings.length,
        };
        for (const finding of reachability.findings) {
          findings.push({
            severity: finding.severity,
            code: finding.code,
            message: `${finding.targetname}: ${finding.detail}`,
          });
        }
        for (const selector of resolvedContract?.contract.managedAbsentEntities ?? []) {
          const matches = entities.filter((entity) => matchesAbsentSelector(entity, selector));
          if (matches.length) {
            findings.push({
              severity: "error",
              code: "managed-absent-entity-present",
              message:
                `Entity required absent by contract is present (${matches.length} match` +
                `${matches.length === 1 ? "" : "es"}): ${absentSelectorLabel(selector)}.`,
            });
          }
        }
        const managedVolumes = resolvedContract?.contract.managedVolumes ?? [];
        if (managedVolumes.length) {
          const volumeResult = reconcileMapVolumes(mapText, managedVolumes);
          if (volumeResult.added.length || volumeResult.updated.length) {
            volumeDrift = {
              missing: volumeResult.added,
              changed: volumeResult.updated,
              unchanged: volumeResult.unchanged,
            };
            findings.push({
              severity: "error",
              code: "managed-volume-drift",
              message:
                `Managed volume drift: ${volumeResult.added.length} missing and ` +
                `${volumeResult.updated.length} changed checked volume(s).`,
            });
          }
        }
        const managedTerrain = resolvedContract?.contract.managedTerrain ?? [];
        if (managedTerrain.length) {
          const terrain = reconcileMapTerrain(
            mapText,
            managedTerrain,
            resolvedContract?.contract.managedPaths ?? [],
          );
          if (terrain.changed) {
            terrainDrift = {
              changedHeightVertices: terrain.changedHeightVertices,
              changedWaterVertices: terrain.changedWaterVertices,
              changedTilesetCells: terrain.changedTilesetCells,
              changedOrientationCells: terrain.changedOrientationCells,
              changedConfigurationCells: terrain.changedConfigurationCells,
              changedPathEdges: terrain.changedPathEdges,
            };
            findings.push({
              severity: "error",
              code: "managed-terrain-drift",
              message:
                `Managed terrain drift: ${terrain.changedHeightVertices} height vertices, ` +
                `${terrain.changedWaterVertices} water vertices, and ` +
                `${terrain.changedTilesetCells} tileset cells plus ` +
                `${terrain.changedOrientationCells} orientation cells and ` +
                `${terrain.changedConfigurationCells} tile recipes plus ` +
                `${terrain.changedPathEdges} path edges differ from the contract.`,
            });
          }
        }
        const byTargetname = new Map<string, typeof entities>();
        for (const entity of entities) {
          if (!entity.targetname) continue;
          const bucket = byTargetname.get(entity.targetname) ?? [];
          bucket.push(entity);
          byTargetname.set(entity.targetname, bucket);
        }

        for (const [targetname, matches] of byTargetname) {
          if (matches.length > 1) {
            findings.push({
              severity: "error",
              code: "duplicate-targetname",
              message: `targetname "${targetname}" is used by ${matches.length} entities.`,
            });
          }
        }

        const managedNames = new Set(managedContractEntities.map((entity) => entity.targetname));
        const managedPathPrefixes = resolvedContract?.contract.managedPaths?.map((path) => `${path.name}_`) ?? [];
        for (const entity of entities) {
          if (!entity.targetname || managedNames.has(entity.targetname)) continue;
          const ownedByManagedPath = managedPathPrefixes.some((prefix) => {
            return entity.targetname!.startsWith(prefix) && /^\d+$/.test(entity.targetname!.slice(prefix.length));
          });
          if (ownedByManagedPath) {
            findings.push({
              severity: "error",
              code: "unexpected-managed-path-node",
              message: `Managed path contains undeclared waypoint "${entity.targetname}".`,
            });
          }
        }

        for (const entity of entities) {
          if (!["path_corner", "path_track"].includes(entity.classname) || !entity.target) continue;
          if (!byTargetname.has(entity.target)) {
            findings.push({
              severity: "error",
              code: "broken-path-target",
              message: `${entity.targetname ?? entity.classname} targets missing waypoint "${entity.target}".`,
            });
          }
        }

        for (const required of requirements) {
          const matches = byTargetname.get(required.targetname) ?? [];
          if (!matches.length) {
            findings.push({
              severity: "error",
              code: "required-entity-missing",
              message: `Required entity "${required.targetname}" is missing.`,
            });
            continue;
          }
          const matchingClass = required.classname
            ? matches.filter((entity) => entity.classname === required.classname)
            : matches;
          if (!matchingClass.length) {
            findings.push({
              severity: "error",
              code: "required-classname-mismatch",
              message: `"${required.targetname}" exists but is not a ${required.classname}.`,
            });
            continue;
          }
          if (required.origin && !matchingClass.some((entity) => entity.origin === required.origin)) {
            findings.push({
              severity: "error",
              code: "required-origin-mismatch",
              message: `"${required.targetname}" is not at origin "${required.origin}".`,
            });
          }
          if (required.angles && !matchingClass.some((entity) => entity.angles === required.angles)) {
            findings.push({
              severity: "error",
              code: "required-angles-mismatch",
              message: `"${required.targetname}" does not have angles "${required.angles}".`,
            });
          }
          if (required.properties) {
            for (const [key, value] of Object.entries(required.properties)) {
              if (!matchingClass.some((entity) => entity.properties[key] === String(value))) {
                findings.push({
                  severity: "error",
                  code: "required-property-mismatch",
                  message: `"${required.targetname}" does not have ${key}="${value}".`,
                });
              }
            }
          }
          for (const key of required.absentProperties ?? []) {
            if (matchingClass.some((entity) => entity.properties[key] !== undefined)) {
              findings.push({
                severity: "error",
                code: "required-property-present",
                message: `"${required.targetname}" must not have property "${key}".`,
              });
            }
          }
        }
      }

      const errors = findings.filter((finding) => finding.severity === "error");
      const header = errors.length
        ? `VALIDATION FAILED: ${errors.length} error(s), ${findings.length - errors.length} warning(s).`
        : `VALIDATION OK: ${entities.length} entities, ${findings.length} warning(s).`;
      const body = findings.map((finding) => `  [${finding.severity.toUpperCase()}] ${finding.message}`).join("\n");
      return json(
        {
          ok: errors.length === 0,
          map,
          project: project.addonName,
          source,
          registered,
          compiled,
          compiledFresh: compiledFreshness?.fresh ?? null,
          sourceModifiedAt: compiledFreshness
            ? new Date(compiledFreshness.sourceModifiedMs).toISOString()
            : null,
          compiledModifiedAt: compiledFreshness
            ? new Date(compiledFreshness.compiledModifiedMs).toISOString()
            : null,
          entityCount: entities.length,
          contract: resolvedContract?.path ?? null,
          requirementCount: requirements.length,
          entityDefinitions: entityDefinitionValidation ?? null,
          terrainDrift: terrainDrift ?? null,
          volumeDrift: volumeDrift ?? null,
          reachability: reachabilitySummary ?? null,
          findings,
        },
        `${header}${body ? `\n${body}` : ""}`,
      );
    }),
  );
}
