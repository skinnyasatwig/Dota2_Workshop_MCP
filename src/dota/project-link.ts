import { lstat, mkdir, realpath, readlink, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathExists } from "../util/fsx.js";

export type ProjectLinkState = "linked" | "ready" | "conflict" | "source-missing";

export interface ProjectLinkPlan {
  source: string;
  destination: string;
  state: ProjectLinkState;
  detail: string;
}

function comparable(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

async function resolvedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function inspectProjectLink(source: string, destination: string): Promise<ProjectLinkPlan> {
  if (!(await pathExists(source))) {
    return { source, destination, state: "source-missing", detail: "Source directory does not exist." };
  }

  if (!(await entryExists(destination))) {
    return { source, destination, state: "ready", detail: "Destination is free; a link can be created." };
  }

  const [sourceResolved, destinationResolved] = await Promise.all([resolvedPath(source), resolvedPath(destination)]);
  if (comparable(sourceResolved) === comparable(destinationResolved)) {
    let detail = "Destination already resolves to the project directory.";
    try {
      const target = await readlink(destination);
      detail += ` Link target: ${target}`;
    } catch {
      // A project already located directly in dota_addons is also linked in practice.
    }
    return { source, destination, state: "linked", detail };
  }

  return {
    source,
    destination,
    state: "conflict",
    detail: `Destination already exists and resolves to ${destinationResolved}; it will not be overwritten.`,
  };
}

export async function createProjectLink(plan: ProjectLinkPlan): Promise<ProjectLinkPlan> {
  if (plan.state !== "ready") return plan;
  await mkdir(dirname(plan.destination), { recursive: true });
  await symlink(plan.source, plan.destination, process.platform === "win32" ? "junction" : "dir");
  return inspectProjectLink(plan.source, plan.destination);
}
