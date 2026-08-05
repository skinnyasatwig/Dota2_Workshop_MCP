import { runWin32Spec, Win32Result, Win32Spec } from "./win32.js";

export interface EngineWindowPreparation {
  requested: boolean;
  ok: boolean;
  result?: Win32Result;
  error?: string;
  attempts?: number;
}

type WindowRunner = (spec: Win32Spec, timeoutMs?: number) => Promise<Win32Result>;

/**
 * Restore and focus an attached Dota window before sending DebugSDK commands.
 * Source 2 can stop servicing VConsole commands while its render window is
 * hidden, so attached checks make this preparation explicit and reportable.
 */
export async function prepareAttachedEngineWindow(
  requested = true,
  runner: WindowRunner = runWin32Spec,
): Promise<EngineWindowPreparation> {
  if (!requested) return { requested: false, ok: true };

  const result = await runner({ focus: false, window: { action: "focus" } });
  if (!result.ok) {
    return {
      requested: true,
      ok: false,
      result,
      error: result.error ?? "Dota's window could not be restored and focused.",
    };
  }

  return { requested: true, ok: true, result };
}

/**
 * Wait for Source 2 to create a usable render window, then restore/focus it.
 * VConsole can begin listening before the SDL window exists, so a single
 * immediate focus attempt is a startup race rather than useful evidence.
 */
export async function waitForEngineWindow(
  requested = true,
  timeoutMs = 30_000,
  pollMs = 500,
  runner: WindowRunner = runWin32Spec,
  pause: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<EngineWindowPreparation> {
  if (!requested) return { requested: false, ok: true, attempts: 0 };

  const attempts = Math.max(1, Math.ceil(timeoutMs / Math.max(1, pollMs)));
  let last: EngineWindowPreparation | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await prepareAttachedEngineWindow(true, runner);
    if (last.ok) return { ...last, attempts: attempt };
    if (attempt < attempts) await pause(pollMs);
  }

  return {
    ...(last ?? { requested: true, ok: false }),
    attempts,
    error: last?.error ?? "Dota's window did not become available before the timeout.",
  };
}
