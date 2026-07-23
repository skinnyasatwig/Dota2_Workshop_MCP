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
} from "../dota/vmap.js";
import { readAddonInfo, registerMapFile } from "../dota/addoninfo.js";
import { compileProjectMap, projectMapPaths } from "../dota/map-project.js";
import { loadMapContract } from "../dota/map-contract.js";
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
      description: "List the addon's maps (from addoninfo.txt) with their source (.vmap) and compiled (.vpk) status.",
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
        maps.push({ name, source: await pathExists(p.contentVmap), compiled: await pathExists(p.gameVpk) });
      }
      return json(
        { count: maps.length, maps },
        maps.length
          ? maps.map((m) => `  ${m.name}  [source: ${m.source ? "yes" : "no"}, compiled: ${m.compiled ? "yes" : "no"}]`).join("\n")
          : "No maps registered in addoninfo.txt.",
      );
    }),
  );

  server.registerTool(
    "map_validate",
    {
      title: "Validate a map and its script contract",
      description:
        "Static preflight for autonomous map work (does not launch Dota): checks source/registration/compiled state, " +
        "extracts entities, finds duplicate targetnames and broken path_corner/path_track links, and verifies required " +
        "targetname/classname pairs used by game scripts.",
      inputSchema: {
        projectRoot: z.string().optional(),
        map: z.string(),
        requiredEntities: z
          .array(
            z.object({
              targetname: z.string(),
              classname: z.string().optional(),
            }),
          )
          .optional()
          .describe("Script contract, e.g. [{targetname:'radiant_t1'}, {targetname:'path_radiant_north_1', classname:'path_corner'}]."),
        contractFile: z
          .string()
          .optional()
          .describe("JSON contract path. Defaults to .dota-workshop/map-contract.json when present."),
        requireCompiled: z.boolean().optional().describe("Treat a missing compiled VPK as an error (default false)."),
      },
    },
    guard(async ({ projectRoot, map, requiredEntities, contractFile, requireCompiled }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      const p = projectMapPaths(dota, project, map);
      const findings: { severity: "error" | "warn"; code: string; message: string }[] = [];
      const resolvedContract = requiredEntities ? undefined : await loadMapContract(project.root, map, contractFile);
      const requirements = requiredEntities ?? resolvedContract?.contract.requiredEntities ?? [];

      const source = await pathExists(p.contentVmap);
      const compiled = await pathExists(p.gameVpk);
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
      }

      let entities: ReturnType<typeof parseMapEntities> = [];
      if (source) {
        entities = parseMapEntities(await vmapToText(dota.dmxconvertExe, p.contentVmap));
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
          } else if (required.classname && !matches.some((entity) => entity.classname === required.classname)) {
            findings.push({
              severity: "error",
              code: "required-classname-mismatch",
              message: `"${required.targetname}" exists but is not a ${required.classname}.`,
            });
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
          entityCount: entities.length,
          contract: resolvedContract?.path ?? null,
          requirementCount: requirements.length,
          findings,
        },
        `${header}${body ? `\n${body}` : ""}`,
      );
    }),
  );
}
