import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { resolveProject } from "../config.js";
import { requireDotaPaths } from "../dota/paths.js";
import { run, spawnDetached, npmCommand, formatCommand } from "../dota/process.js";
import { AddonProject } from "../dota/project.js";
import { buildDotaLaunchTarget, buildLaunchArgs } from "../dota/launch.js";
import { defaultVconPort } from "../dota/vconsole.js";
import { pathExists } from "../util/fsx.js";
import { createProjectLink, inspectProjectLink } from "../dota/project-link.js";
import { json, text, error, guard, ToolResult } from "../util/result.js";

async function resolveAddonName(projectRoot: string | undefined, addon: string | undefined): Promise<{ name: string; project?: AddonProject }> {
  if (addon) return { name: addon };
  const project = await resolveProject(projectRoot);
  return { name: project.addonName, project };
}

export function registerBuildTools(server: McpServer) {
  server.registerTool(
    "addon_build",
    {
      title: "Build the addon",
      description:
        "Compile the addon's scripts. For a TS template this runs `npm run build` (typescript-to-lua + panorama). " +
        "Returns compiler output; check for type errors.",
      inputSchema: {
        projectRoot: z.string().optional(),
        dryRun: z.boolean().optional().describe("Return the command without running it."),
      },
    },
    guard(async ({ projectRoot, dryRun }): Promise<ToolResult> => {
      const project = await resolveProject(projectRoot);
      const cmd = `${npmCommand()} run build`;
      if (dryRun) return text(`[dry run] (cwd: ${project.root})\n${cmd}`);
      if (!project.hasTstl) {
        return error(
          "This project is not a TypeScript template (no typescript-to-lua). Use addon_compile_content for raw content, " +
            "or build it with your own toolchain.",
        );
      }
      const res = await run(npmCommand(), ["run", "build"], { cwd: project.root, timeoutMs: 600_000 });
      const ok = res.code === 0;
      return json(
        { command: res.command, exitCode: res.code, ok, timedOut: res.timedOut },
        `${ok ? "BUILD OK" : "BUILD FAILED"} (exit ${res.code})\n$ ${res.command}\n\n${res.stdout}\n${res.stderr}`.trim(),
      );
    }),
  );

  server.registerTool(
    "addon_compile_content",
    {
      title: "Compile addon content (resourcecompiler)",
      description:
        "Run resourcecompiler.exe over the addon's content (maps .vmap, particles .vpcf, materials, panorama) into " +
        "the compiled game tree. The addon must be linked into the Dota content/dota_addons folder.",
      inputSchema: {
        projectRoot: z.string().optional(),
        addon: z.string().optional().describe("Addon folder name (defaults to the project's addon name)."),
        force: z.boolean().optional().describe("Force full rebuild (-f)."),
        dryRun: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, addon, force, dryRun }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const { name } = await resolveAddonName(projectRoot, addon);
      const contentPath = join(dota.contentDotaAddons, name);
      // -game must point at the folder containing gameinfo.gi (game/dota); the compiler
      // maps the content/ path back to the addon automatically.
      const args = ["-v", "-nop4", "-i", join(contentPath, "*"), "-r", "-game", dota.dotaGameDir];
      if (force) args.splice(2, 0, "-f");
      const cmd = `"${dota.resourceCompilerExe}" ${args.join(" ")}`;
      if (dryRun) return text(`[dry run]\n${cmd}`);
      if (!(await pathExists(contentPath))) {
        return error(`Content folder not found: ${contentPath}. Link the addon into Dota first (addon_link / scripts/install.js).`);
      }
      const res = await run(dota.resourceCompilerExe, args, { timeoutMs: 600_000 });
      const ok = res.code === 0;
      return json(
        { command: res.command, exitCode: res.code, ok },
        `${ok ? "COMPILE OK" : "COMPILE FAILED"} (exit ${res.code})\n$ ${res.command}\n\n${res.stdout}\n${res.stderr}`.trim(),
      );
    }),
  );

  server.registerTool(
    "addon_launch_tools",
    {
      title: "Launch Workshop Tools",
      description:
        "Launch Dota 2 in Workshop Tools mode for the addon (dota2.exe -tools -addon <name>). This opens the Workshop " +
        "Tools hub from which Hammer (maps), the Particle/Model/Material editors and the Asset Browser are launched. " +
        "Optionally start a map directly. Runs detached.",
      inputSchema: {
        projectRoot: z.string().optional(),
        addon: z.string().optional(),
        map: z.string().optional().describe("If set, also runs +dota_launch_custom_game <addon> <map>."),
        console: z.boolean().optional().describe("Add -console (default true)."),
        vconPort: z.number().int().min(1).max(65535).optional().describe("VConsole listener port (-vconport). Default 29000."),
        dryRun: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, addon, map, console: withConsole, vconPort, dryRun }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const { name } = await resolveAddonName(projectRoot, addon);
      const args = buildLaunchArgs({
        addon: name,
        map,
        console: withConsole !== false,
        dev: true,
        vconPort: vconPort ?? defaultVconPort(),
      });
      const target = buildDotaLaunchTarget(dota.root, dota.dota2Exe, args, { steamExe: dota.steamExe });
      const cmd = formatCommand(target.executable, target.args);
      if (dryRun) return text(`[dry run]\n${cmd}`);
      const { pid } = spawnDetached(target.executable, target.args, target.cwd);
      return json(
        { command: cmd, pid, addon: name, launchMethod: target.method },
        `Launched Workshop Tools via ${target.method} (pid ${pid}):\n${cmd}`,
      );
    }),
  );

  server.registerTool(
    "addon_launch_custom_game",
    {
      title: "Launch & start a custom game",
      description:
        "Launch Dota 2 (tools mode) and immediately start the addon's custom game on a map for testing " +
        "(dota2.exe -addon <name> -tools -console -insecure +dota_launch_custom_game <name> <map>).",
      inputSchema: {
        projectRoot: z.string().optional(),
        addon: z.string().optional(),
        map: z.string().describe("Map name from the addon's addoninfo.txt 'maps' list."),
        vconPort: z.number().int().min(1).max(65535).optional().describe("VConsole listener port (-vconport). Default 29000."),
        cheats: z.boolean().optional().describe("Enable sv_cheats + developer (default true)."),
        dryRun: z.boolean().optional(),
      },
    },
    guard(async ({ projectRoot, addon, map, vconPort, cheats, dryRun }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const { name } = await resolveAddonName(projectRoot, addon);
      const args = buildLaunchArgs({
        addon: name,
        map,
        insecure: true,
        dev: true,
        cheats: cheats !== false,
        vconPort: vconPort ?? defaultVconPort(),
      });
      const target = buildDotaLaunchTarget(dota.root, dota.dota2Exe, args, { steamExe: dota.steamExe });
      const cmd = formatCommand(target.executable, target.args);
      if (dryRun) return text(`[dry run]\n${cmd}`);
      const { pid } = spawnDetached(target.executable, target.args, target.cwd);
      return json(
        { command: cmd, pid, addon: name, map, launchMethod: target.method },
        `Launching custom game "${name}" on "${map}" via ${target.method} (pid ${pid}):\n${cmd}`,
      );
    }),
  );

  server.registerTool(
    "addon_link",
    {
      title: "Link addon into Dota",
      description:
        "Safely link any supported addon's game/content folders into Dota's dota_addons trees. Existing unrelated " +
        "folders are reported as conflicts and never overwritten. Use dryRun=true to review the exact paths first. " +
        "Required before compiling or launching.",
      inputSchema: { projectRoot: z.string().optional(), dryRun: z.boolean().optional() },
    },
    guard(async ({ projectRoot, dryRun }): Promise<ToolResult> => {
      const dota = await requireDotaPaths();
      const project = await resolveProject(projectRoot);
      if (project.type === "repo" && project.contentDir === project.root) {
        return error(
          "This legacy repository keeps maps in root/maps, so linking would expose the entire repository as Dota " +
            `content. Move maps to content/dota_addons/${project.addonName}/maps first, then rerun this tool.`,
        );
      }
      const plans = await Promise.all([
        inspectProjectLink(project.gameDir, join(dota.gameDotaAddons, project.addonName)),
        inspectProjectLink(project.contentDir, join(dota.contentDotaAddons, project.addonName)),
      ]);
      const blocked = plans.some((plan) => plan.state === "conflict" || plan.state === "source-missing");
      const results = !dryRun && !blocked ? await Promise.all(plans.map((plan) => createProjectLink(plan))) : plans;
      const conflicts = results.filter((plan) => plan.state === "conflict" || plan.state === "source-missing");
      const pending = results.filter((plan) => plan.state === "ready");
      const linked = results.filter((plan) => plan.state === "linked");
      const header = dryRun
        ? `Link plan: ${linked.length}/2 already linked, ${pending.length} ready, ${conflicts.length} conflict(s).`
        : `Link result: ${linked.length}/2 linked, ${conflicts.length} conflict(s).`;
      const body = results
        .map((plan) => `  [${plan.state.toUpperCase()}] ${plan.destination}\n      source: ${plan.source}\n      ${plan.detail}`)
        .join("\n");
      return json(
        {
          addonName: project.addonName,
          dryRun: !!dryRun,
          ok: conflicts.length === 0 && (dryRun ? true : linked.length === 2),
          links: results,
        },
        `${header}\n${body}${dryRun && pending.length ? "\nReview the paths, get permission, then call again with dryRun=false." : ""}`,
      );
    }),
  );
}
