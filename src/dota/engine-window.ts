import { runWin32Spec, Win32Result, Win32Spec } from "./win32.js";

export interface EngineWindowPreparation {
  requested: boolean;
  ok: boolean;
  result?: Win32Result;
  error?: string;
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
