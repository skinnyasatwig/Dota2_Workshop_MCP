import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
  reconcileMapEntities,
  rewriteWaypointPath,
  absentSelectorLabel,
  matchesAbsentSelector,
} from "../dota/vmap.js";
import { readAddonInfo, registerMapFile } from "../dota/addoninfo.js";
import { compileProjectMap, projectMapPaths } from "../dota/map-project.js";
import { loadMapContract, managedEntitiesForContract } from "../dota/map-contract.js";
import { inspectMapText } from "../dota/map-inspect.js";
import { reconcileMapTerrain } from "../dota/map-terrain.js";
import { inspectMapArtifactFreshness } from "../dota/map-freshness.js";
import {
  validateDotaBuildingEntities,
  validateDotaNeutralSpawners,
} from "../dota/map-semantics.js";
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
        "Preview or apply desired managedEntities, managedAbsentEntities, compact managedPaths, and managedTerrain " +
        "operations from " +
        ".dota-workshop/map-contract.json. Paths expand into complete linked waypoint chains. Missing named entities " +
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
      const resolved = await loadMapContract(project.root, map, contractFile);
      if (!resolved) return error(`Map contract not found under ${project.root}.`);
      const specs = managedEntitiesForContract(resolved.contract);
      const absentEntities = resolved.contract.managedAbsentEntities ?? [];
      const terrainOperations = resolved.contract.managedTerrain ?? [];
      if (!specs.length && !absentEntities.length && !terrainOperations.length) {
        return error(
          `Contract has no managedEntities, managedAbsentEntities, managedPaths, or managedTerrain to synchronize: ${resolved.path}`,
        );
      }

      const current = await vmapToText(dota.dmxconvertExe, p.contentVmap);
      const prunePrefixes = (resolved.contract.managedPaths ?? []).map((path) => path.name);
      const result = reconcileMapEntities(current, specs, {
        prunePrefixes,
        absentEntities,
      });
      if (result.conflicts.length) {
        return error(
          `No changes written. Duplicate targetnames make these managed entities ambiguous: ${result.conflicts.join(", ")}`,
        );
      }

      const terrain = reconcileMapTerrain(
        result.text,
        terrainOperations,
        resolved.contract.managedPaths ?? [],
      );
      const changedEntities = result.added.length + result.updated.length + result.removed.length;
      const changed = changedEntities + (terrain.changed ? 1 : 0);
      if (apply && changed) await textToVmap(dota.dmxconvertExe, terrain.text, p.contentVmap);
      const steps = [
        `${apply ? "Synchronized" : "Previewed"} ${specs.length} desired entities and ` +
          `${absentEntities.length} absence selectors in "${map}".`,
        `Add ${result.added.length}, update ${result.updated.length}, remove ${result.removed.length}, ` +
          `unchanged ${result.unchanged.length}.`,
        `Terrain: ${terrainOperations.length} operations; change ${terrain.changedHeightVertices} height vertices, ` +
          `${terrain.changedWaterVertices} water vertices, ${terrain.changedTilesetCells} tileset cells.`,
      ];
      if (!apply && changed) steps.push("No files changed. Pass apply=true to write this plan.");
      if (apply && recompile) {
        const res = await compileProjectMap(dota, project, map);
        steps.push(res.code === 0 ? `Recompiled -> ${p.installedGameVpk}` : `Recompile FAILED (exit ${res.code})`);
      }
      return json(
        {
          map,
          contract: resolved.path,
          applied: apply === true,
          changed,
          changedEntities,
          added: result.added,
          updated: result.updated,
          removed: result.removed,
          unchanged: result.unchanged,
          terrain: {
            changed: terrain.changed,
            changedHeightVertices: terrain.changedHeightVertices,
            changedWaterVertices: terrain.changedWaterVertices,
            changedTilesetCells: terrain.changedTilesetCells,
            operations: terrain.operations,
          },
          recompiled: apply === true && recompile === true,
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
        "targetname/classname pairs used by game scripts. When a project contract declares managedTerrain, validation " +
        "also reports tile-grid drift without writing it.",
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
      },
    },
    guard(async ({ projectRoot, map, requiredEntities, contractFile, requireCompiled }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      const findings: { severity: "error" | "warn"; code: string; message: string }[] = [];
      const resolvedContract = requiredEntities ? undefined : await loadMapContract(project.root, map, contractFile);
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
      let terrainDrift:
        | {
            changedHeightVertices: number;
            changedWaterVertices: number;
            changedTilesetCells: number;
          }
        | undefined;
      if (source) {
        const mapText = await vmapToText(dota.dmxconvertExe, p.contentVmap);
        entities = parseMapEntities(mapText);
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
            };
            findings.push({
              severity: "error",
              code: "managed-terrain-drift",
              message:
                `Managed terrain drift: ${terrain.changedHeightVertices} height vertices, ` +
                `${terrain.changedWaterVertices} water vertices, and ` +
                `${terrain.changedTilesetCells} tileset cells differ from the contract.`,
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
          terrainDrift: terrainDrift ?? null,
          findings,
        },
        `${header}${body ? `\n${body}` : ""}`,
      );
    }),
  );
}
