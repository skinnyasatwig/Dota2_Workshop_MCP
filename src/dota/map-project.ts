import { join } from "node:path";
import { AddonProject } from "./project.js";
import { DotaPaths } from "./paths.js";
import { compileVmap } from "./vmap.js";
import { inspectProjectLink } from "./project-link.js";

export interface ProjectMapPaths {
  contentVmap: string;
  gameVpk: string;
  installedContentVmap: string;
  installedGameVpk: string;
  addoninfo: string;
  baseTemplate: string;
}

export function projectMapPaths(dota: DotaPaths, project: AddonProject, name: string): ProjectMapPaths {
  return {
    contentVmap: join(project.contentDir, "maps", `${name}.vmap`),
    gameVpk: join(project.gameDir, "maps", `${name}.vpk`),
    installedContentVmap: join(dota.contentDotaAddons, project.addonName, "maps", `${name}.vmap`),
    installedGameVpk: join(dota.gameDotaAddons, project.addonName, "maps", `${name}.vpk`),
    addoninfo: join(project.gameDir, "addoninfo.txt"),
    baseTemplate: join(dota.contentDotaAddons, "addon_template", "maps", "template_map.vmap"),
  };
}

export async function assertProjectLinkedForCompile(dota: DotaPaths, project: AddonProject): Promise<void> {
  const [game, content] = await Promise.all([
    inspectProjectLink(project.gameDir, join(dota.gameDotaAddons, project.addonName)),
    inspectProjectLink(project.contentDir, join(dota.contentDotaAddons, project.addonName)),
  ]);
  if (game.state !== "linked" || content.state !== "linked") {
    throw new Error(
      `Addon "${project.addonName}" is not safely linked into Dota (game=${game.state}, content=${content.state}). ` +
        "Run addon_link_project with apply=false, review the plan, then apply it before compiling.",
    );
  }
}

export async function compileProjectMap(
  dota: DotaPaths,
  project: AddonProject,
  name: string,
  force = false,
) {
  await assertProjectLinkedForCompile(dota, project);
  const paths = projectMapPaths(dota, project, name);
  return compileVmap(
    dota.resourceCompilerExe,
    dota.dotaGameDir,
    paths.installedContentVmap,
    paths.installedGameVpk,
    force,
  );
}
