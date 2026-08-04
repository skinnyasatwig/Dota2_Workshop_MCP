import { DotaPaths } from "./paths.js";
import { buildDirectDotaLaunchTarget, buildDotaLaunchTarget, buildLaunchArgs } from "./launch.js";
import { isProcessRunning, killProcess, spawnDetached } from "./process.js";
import { defaultVconPort, getVConsole } from "./vconsole.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GameLaunchResult {
  pid?: number;
  command: string;
  killed: boolean;
  reconnected: boolean;
  method: "steam" | "direct";
  fallbackUsed: boolean;
  primaryCommand?: string;
}

export type GameLaunchStrategy = "auto" | "steam" | "direct";

export interface GameShutdownResult {
  quitSent: boolean;
  forceKilled: boolean;
  stopped: boolean;
  detail: string;
}

/** Full relaunch helper shared by debugging, self-tests, and engine map checks. */
export async function restartGame(
  dota: DotaPaths,
  addon: string,
  map: string,
  port: number,
  cheats: boolean,
  reconnect: boolean,
  strategy: GameLaunchStrategy = "auto",
  renderer?: "dx11" | "vulkan",
): Promise<GameLaunchResult> {
  const args = buildLaunchArgs({ addon, map, insecure: true, dev: true, cheats, vconPort: port, renderer });
  let target =
    strategy === "direct"
      ? buildDirectDotaLaunchTarget(dota.dota2Exe, args)
      : buildDotaLaunchTarget(dota.root, dota.dota2Exe, args, { steamExe: dota.steamExe });
  if (strategy === "steam" && target.method !== "steam") {
    throw new Error("Steam launch was requested, but steam.exe could not be located.");
  }
  getVConsole(port).disconnect();
  const kill = await killProcess("dota2.exe");
  await sleep(1500);
  const primary = spawnDetached(target.executable, target.args, target.cwd);
  let pid = primary.pid;
  let command = primary.command;
  let fallbackUsed = false;

  // On some Windows/Steam states, a second steam.exe accepts -applaunch and
  // exits without forwarding it to the already-running client. Bound that
  // ambiguity before falling back; only the process that actually starts Dota
  // counts as the one engine session.
  if (strategy === "auto" && target.method === "steam") {
    const processDeadline = Date.now() + 20_000;
    while (Date.now() < processDeadline && !(await isProcessRunning("dota2.exe"))) {
      await sleep(500);
    }
    if (!(await isProcessRunning("dota2.exe"))) {
      const direct = buildDirectDotaLaunchTarget(dota.dota2Exe, args);
      const fallback = spawnDetached(direct.executable, direct.args, direct.cwd);
      target = direct;
      pid = fallback.pid;
      command = fallback.command;
      fallbackUsed = true;
    }
  }
  let reconnected = false;
  if (reconnect) {
    try {
      await getVConsole(port).connectWithRetry(60_000, 1000);
      reconnected = true;
    } catch {
      // The caller can continue waiting and report a map-specific readiness failure.
    }
  }
  return {
    pid,
    command,
    killed: kill.code === 0,
    reconnected,
    method: target.method,
    fallbackUsed,
    primaryCommand: fallbackUsed ? primary.command : undefined,
  };
}

/**
 * Close only the Dota session the caller intentionally launched. A graceful
 * console quit is attempted first; force-kill is a bounded fallback.
 */
export async function shutdownGame(
  port = defaultVconPort(),
  gracefulTimeoutMs = 15_000,
): Promise<GameShutdownResult> {
  const vc = getVConsole(port);
  let quitSent = false;
  try {
    if (!vc.isConnected()) await vc.connect(1500);
    vc.send("quit");
    quitSent = true;
    await sleep(250);
  } catch {
    // The game may already be gone; the process check below is authoritative.
  } finally {
    vc.disconnect();
  }

  const deadline = Date.now() + gracefulTimeoutMs;
  while (Date.now() < deadline) {
    if (!(await isProcessRunning("dota2.exe"))) {
      return {
        quitSent,
        forceKilled: false,
        stopped: true,
        detail: quitSent ? "Dota accepted the graceful quit command." : "Dota had already stopped.",
      };
    }
    await sleep(500);
  }

  const killed = await killProcess("dota2.exe");
  const forceKilled = killed.code === 0;
  const forceDeadline = Date.now() + 5000;
  while (Date.now() < forceDeadline) {
    if (!(await isProcessRunning("dota2.exe"))) {
      return {
        quitSent,
        forceKilled,
        stopped: true,
        detail: "Dota did not exit in time and was closed by the bounded fallback.",
      };
    }
    await sleep(250);
  }
  return {
    quitSent,
    forceKilled,
    stopped: false,
    detail: "Dota was still running after graceful and force-close attempts.",
  };
}
