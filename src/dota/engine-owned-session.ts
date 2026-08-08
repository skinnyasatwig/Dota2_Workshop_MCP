import { closeTransientStallDialog, CloseStallResult, diagnoseDota, DotaDiagnosis } from "./diagnose.js";
import { EngineWindowPreparation, waitForEngineWindow } from "./engine-window.js";
import {
  GameLaunchResult,
  GameLaunchStrategy,
  GameShutdownResult,
  restartGame,
  shutdownGame,
} from "./game-session.js";
import { DotaPaths } from "./paths.js";
import { isProcessRunning } from "./process.js";
import { getVConsole, VConsoleClient } from "./vconsole.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface OwnedEngineSessionDependencies {
  restart: typeof restartGame;
  shutdown: typeof shutdownGame;
  processRunning: typeof isProcessRunning;
  consoleForPort: typeof getVConsole;
  diagnose: typeof diagnoseDota;
  closeStall: typeof closeTransientStallDialog;
  waitForWindow: typeof waitForEngineWindow;
  pause: (ms: number) => Promise<unknown>;
}

const DEFAULT_DEPENDENCIES: OwnedEngineSessionDependencies = {
  restart: restartGame,
  shutdown: shutdownGame,
  processRunning: isProcessRunning,
  consoleForPort: getVConsole,
  diagnose: diagnoseDota,
  closeStall: closeTransientStallDialog,
  waitForWindow: waitForEngineWindow,
  pause: sleep,
};

function dependenciesWith(
  overrides: Partial<OwnedEngineSessionDependencies>,
): OwnedEngineSessionDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

export interface TransientStallHandlingResult {
  initialDiagnosis: DotaDiagnosis;
  diagnosis: DotaDiagnosis;
  dismissals: CloseStallResult[];
}

export class EngineSessionBlockedError extends Error {
  constructor(public readonly handling: TransientStallHandlingResult) {
    const blocker = handling.diagnosis.blockers[0];
    super(
      `Dota is blocked by ${blocker?.role ?? "a dialog"}: ` +
        `${blocker?.title || blocker?.className || "unknown window"}.`,
    );
    this.name = "EngineSessionBlockedError";
  }
}

/**
 * Close only Source 2's exact watchdog stalls, then fail if any blocking
 * dialog remains. Assertions, crash dialogs, and generic dialogs are never
 * clicked by this path.
 */
export async function dismissTransientEngineStalls(
  dependencyOverrides: Partial<OwnedEngineSessionDependencies> = {},
): Promise<TransientStallHandlingResult> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const initialDiagnosis = await dependencies.diagnose();
  const dismissals: CloseStallResult[] = [];
  for (const blocker of initialDiagnosis.blockers.filter((window) => window.role === "stall").slice(0, 3)) {
    dismissals.push(await dependencies.closeStall(blocker));
  }
  if (dismissals.length) await dependencies.pause(250);
  const diagnosis = dismissals.length ? await dependencies.diagnose() : initialDiagnosis;
  const result = { initialDiagnosis, diagnosis, dismissals };
  if (diagnosis.blocked) {
    throw new EngineSessionBlockedError(result);
  }
  return result;
}

export interface OwnedEngineSessionOptions {
  dota: DotaPaths;
  addon: string;
  map: string;
  port: number;
  launchStrategy?: GameLaunchStrategy;
  renderer?: "dx11" | "vulkan";
  replaceRunningDota?: boolean;
  dismissTransientStalls?: boolean;
  focusWindow?: boolean;
  windowTimeoutMs?: number;
  windowPollMs?: number;
  shutdownTimeoutMs?: number;
  consoleTailLines?: number;
}

export interface OwnedEngineSessionContext {
  console: VConsoleClient;
}

export interface OwnedEngineSessionResult<T> {
  dotaWasRunning: boolean;
  launchAttempted: boolean;
  launch?: GameLaunchResult;
  startupDiagnosis?: DotaDiagnosis;
  transientStallDismissals: CloseStallResult[];
  windowPreparation?: EngineWindowPreparation;
  value?: T;
  fatalError?: string;
  consoleTail: string[];
  shutdown: GameShutdownResult;
}

function noShutdownNeeded(detail: string): GameShutdownResult {
  return { quitSent: false, forceKilled: false, stopped: true, detail };
}

/**
 * Run one callback inside a Dota session owned by the caller. Launch,
 * VConsole connection, safe watchdog dismissal, render-window preparation,
 * evidence retention, and shutdown share one bounded lifecycle.
 */
export async function runOwnedEngineSession<T>(
  options: OwnedEngineSessionOptions,
  execute: (context: OwnedEngineSessionContext) => Promise<T>,
  dependencyOverrides: Partial<OwnedEngineSessionDependencies> = {},
): Promise<OwnedEngineSessionResult<T>> {
  const dependencies = dependenciesWith(dependencyOverrides);
  const console = dependencies.consoleForPort(options.port);
  let dotaWasRunning = false;
  let launchAttempted = false;
  let launch: GameLaunchResult | undefined;
  let startupDiagnosis: DotaDiagnosis | undefined;
  let transientStallDismissals: CloseStallResult[] = [];
  let windowPreparation: EngineWindowPreparation | undefined;
  let value: T | undefined;
  let fatalError: string | undefined;
  let consoleTail: string[] = [];
  let shutdown = noShutdownNeeded("Dota was not launched.");

  try {
    dotaWasRunning = await dependencies.processRunning("dota2.exe");
    if (dotaWasRunning && options.replaceRunningDota !== true) {
      shutdown = noShutdownNeeded("The pre-existing Dota session was preserved.");
      throw new Error(
        "Dota is already running. The owned engine session refused to replace it without explicit permission.",
      );
    }
    launchAttempted = true;
    launch = await dependencies.restart(
      options.dota,
      options.addon,
      options.map,
      options.port,
      true,
      true,
      options.launchStrategy ?? "auto",
      options.renderer,
    );
    if (!console.isConnected()) await console.connectWithRetry(60_000, 1000);
    if (options.dismissTransientStalls !== false) {
      const stallHandling = await dismissTransientEngineStalls(dependencies);
      startupDiagnosis = stallHandling.diagnosis;
      transientStallDismissals = stallHandling.dismissals;
    }
    windowPreparation = await dependencies.waitForWindow(
      options.focusWindow !== false,
      options.windowTimeoutMs ?? 30_000,
      options.windowPollMs ?? 500,
    );
    if (!windowPreparation.ok) {
      throw new Error(`Could not prepare the Dota window: ${windowPreparation.error ?? "unknown error"}`);
    }
    value = await execute({ console });
  } catch (caught) {
    if (caught instanceof EngineSessionBlockedError) {
      startupDiagnosis = caught.handling.diagnosis;
      transientStallDismissals = caught.handling.dismissals;
    }
    fatalError = caught instanceof Error ? caught.message : String(caught);
  } finally {
    try {
      consoleTail = console.recent(options.consoleTailLines ?? 300).map((line) => line.text);
    } catch {
      // Console evidence is best effort; shutdown is still mandatory.
    }
    try {
      if (launchAttempted) {
        const running = launch !== undefined || await dependencies.processRunning("dota2.exe");
        if (running) {
          shutdown = await dependencies.shutdown(options.port, options.shutdownTimeoutMs ?? 15_000);
        } else {
          console.disconnect();
          shutdown = noShutdownNeeded("Dota never started; no shutdown action was needed.");
        }
      }
    } catch (caught) {
      console.disconnect();
      shutdown = {
        quitSent: false,
        forceKilled: false,
        stopped: false,
        detail: `Dota shutdown failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      };
    }
  }

  return {
    dotaWasRunning,
    launchAttempted,
    launch,
    startupDiagnosis,
    transientStallDismissals,
    windowPreparation,
    value,
    fatalError,
    consoleTail,
    shutdown,
  };
}
