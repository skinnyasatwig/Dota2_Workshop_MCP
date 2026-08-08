import { ConsoleLine, VConsoleClient } from "./vconsole.js";

export interface EngineReadinessPong {
  state: number;
  gameTime?: number;
  line: string;
}

export interface EngineReadinessStateSample extends EngineReadinessPong {
  elapsedMs: number;
}

export interface EngineReadinessObservation {
  ready: boolean;
  targetGameState: number;
  durationMs: number;
  pongCount: number;
  highestState?: number;
  lastPong?: string;
  timeline: EngineReadinessStateSample[];
  stoppedReason?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let readinessSequence = 0;

/** Parse the stable, machine-readable line emitted by the bundled DebugSDK. */
export function parseEngineReadinessPong(line: string): EngineReadinessPong | undefined {
  if (!line.includes("[MCP] PONG")) return undefined;
  const state = /\bstate=(\d+)\b/.exec(line);
  if (!state) return undefined;
  const gameTime = /\bt=(-?\d+(?:\.\d+)?)\b/.exec(line);
  return {
    state: Number(state[1]),
    gameTime: gameTime ? Number(gameTime[1]) : undefined,
    line,
  };
}

/** Keep only console evidence that helps explain why an addon did or did not become ready. */
export function isEngineReadinessSignal(line: string): boolean {
  return /(\[MCP\]|addon|custom game|game.?state|hero selection|map (?:load|loading|failed)|loading map|changelevel|server spawn|vscript|script error|stack traceback|lua runtime error|assert|fatal|crash|stall|failed|error:)/i.test(
    line,
  );
}

export function selectEngineReadinessSignals(
  lines: readonly Pick<ConsoleLine, "text">[],
  limit = 200,
): string[] {
  const selected: string[] = [];
  for (const line of lines) {
    if (!isEngineReadinessSignal(line.text)) continue;
    if (selected.at(-1) === line.text) continue;
    selected.push(line.text);
  }
  return selected.slice(-Math.max(0, limit));
}

/** Fatal startup lines for which waiting longer cannot make the current session ready. */
export function engineStartupFatalReason(line: string): string | undefined {
  if (/NVAPI_ACCESS_DENIED|failed to initialize nvidia driver/i.test(line)) {
    return "Dota reported an NVIDIA driver-profile access failure.";
  }
  if (/unable to start game/i.test(line)) return "Dota reported that it was unable to start the game.";
  return undefined;
}

/**
 * Poll the DebugSDK and retain state transitions, not merely the final ping.
 * One VConsole session is observed; this function never launches or closes Dota.
 */
export async function observeEngineReadiness(
  vc: VConsoleClient,
  targetGameState = 3,
  timeoutMs = 90_000,
  pollMs = 1000,
  stopWhen?: () => Promise<string | undefined>,
): Promise<EngineReadinessObservation> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const timeline: EngineReadinessStateSample[] = [];
  let pongCount = 0;
  let highestState: number | undefined;
  let lastPong: string | undefined;
  let stoppedReason: string | undefined;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const requestId = `ready_${Date.now().toString(36)}_${(readinessSequence++).toString(36)}`;
    let latest: EngineReadinessPong | undefined;
    const response = vc.waitForLine(
      (line) => {
        const fatal = engineStartupFatalReason(line.text);
        if (fatal) {
          stoppedReason = fatal;
          return true;
        }
        const parsed = parseEngineReadinessPong(line.text);
        if (!parsed) return false;
        if (!line.text.includes(`request=${requestId}`)) return false;
        latest = parsed;
        pongCount++;
        lastPong = parsed.line;
        highestState = highestState === undefined ? parsed.state : Math.max(highestState, parsed.state);
        if (timeline.at(-1)?.state !== parsed.state) {
          timeline.push({ ...parsed, elapsedMs: Date.now() - startedAt });
        }
        return parsed.state >= targetGameState;
      },
      Math.min(pollMs, remaining),
    );
    try {
      vc.send(`mcp_ping ${requestId}`);
    } catch {
      // A later poll may succeed while Dota or the addon is still loading.
    }
    const readyLine = await response;
    if (readyLine) {
      return {
        ready: !stoppedReason,
        targetGameState,
        durationMs: Date.now() - startedAt,
        pongCount,
        highestState,
        lastPong,
        timeline,
        stoppedReason,
      };
    }
    if (stopWhen) {
      stoppedReason = await stopWhen();
      if (stoppedReason) {
        return {
          ready: false,
          targetGameState,
          durationMs: Date.now() - startedAt,
          pongCount,
          highestState,
          lastPong,
          timeline,
          stoppedReason,
        };
      }
    }
    // Avoid a hot loop if a fake/test VConsole resolves immediately.
    if (!latest && Date.now() < deadline) await sleep(Math.min(50, deadline - Date.now()));
  }

  return {
    ready: false,
    targetGameState,
    durationMs: Date.now() - startedAt,
    pongCount,
    highestState,
    lastPong,
    timeline,
    stoppedReason,
  };
}

export function explainEngineReadiness(
  observation: EngineReadinessObservation | undefined,
  blocked = false,
): string {
  if (blocked) return "Dota opened, but a blocking dialog prevented normal progress.";
  if (!observation) return "The readiness observation could not start.";
  if (observation.stoppedReason) return observation.stoppedReason;
  if (observation.ready) {
    return `The addon answered and reached game state ${observation.highestState}.`;
  }
  if (observation.pongCount === 0) {
    return "VConsole connected, but the addon DebugSDK never answered; addon startup or script bootstrap is the likely choke point.";
  }
  return `The addon answered, but Dota remained below game state ${observation.targetGameState} (highest observed: ${observation.highestState}).`;
}
