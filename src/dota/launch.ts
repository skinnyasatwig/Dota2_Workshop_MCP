// Shared builder for Dota 2 launch arguments, used by the launch + restart tools.

import { existsSync } from "node:fs";
import { dirname, resolve, win32 } from "node:path";

export interface LaunchOpts {
  addon: string;
  map?: string;
  tools?: boolean; // -tools (default true; required for Workshop Tools + VConsole)
  console?: boolean; // -console (default true)
  insecure?: boolean; // -insecure
  dev?: boolean; // -dev -uidev (developer/UI dev mode)
  vconPort?: number; // -vconport <port> (pins the VConsole listener port)
  cheats?: boolean; // +sv_cheats 1 +developer 1 (default true when a map is launched)
}

export function buildLaunchArgs(o: LaunchOpts): string[] {
  const args = ["-novid"];
  if (o.tools !== false) args.push("-tools");
  args.push("-addon", o.addon);
  if (o.console !== false) args.push("-console");
  if (o.insecure) args.push("-insecure");
  if (o.dev) args.push("-dev", "-uidev");
  if (o.vconPort) args.push("-vconport", String(o.vconPort));
  if (o.map) {
    if (o.cheats !== false) args.push("+sv_cheats", "1", "+developer", "1");
    args.push("+dota_launch_custom_game", o.addon, o.map);
  }
  return args;
}

export interface DotaLaunchTarget {
  executable: string;
  args: string[];
  cwd: string;
  method: "steam" | "direct";
}

export function buildDirectDotaLaunchTarget(
  dota2Exe: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): DotaLaunchTarget {
  return {
    executable: dota2Exe,
    args,
    cwd: (platform === "win32" ? win32 : { dirname }).dirname(dota2Exe),
    method: "direct",
  };
}

/**
 * Choose the reliable Windows launch path.
 *
 * Starting dota2.exe directly can leave a half-initialized tools process with a
 * VConsole socket but no game window. When Steam is available, use
 * `steam.exe -applaunch 570 ...` so Dota receives the normal app environment.
 */
export function buildDotaLaunchTarget(
  dotaRoot: string,
  dota2Exe: string,
  args: string[],
  options: {
    platform?: NodeJS.Platform;
    pathExists?: (path: string) => boolean;
    steamExe?: string;
  } = {},
): DotaLaunchTarget {
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const pathApi = platform === "win32" ? win32 : { resolve, dirname };
  const direct =
    platform === "win32"
      ? buildDirectDotaLaunchTarget(dota2Exe, args, platform)
      : { executable: dota2Exe, args, cwd: pathApi.dirname(dota2Exe), method: "direct" as const };

  if (platform !== "win32") return direct;
  const inferredSteamExe = pathApi.resolve(dotaRoot, "..", "..", "..", "steam.exe");
  const steamExe = [options.steamExe, inferredSteamExe].find((candidate) => candidate && pathExists(candidate));
  if (!steamExe) return direct;
  return {
    executable: steamExe,
    args: ["-applaunch", "570", ...args],
    cwd: pathApi.dirname(steamExe),
    method: "steam",
  };
}
