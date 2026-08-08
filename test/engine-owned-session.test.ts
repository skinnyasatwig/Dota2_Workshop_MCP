import assert from "node:assert/strict";
import test from "node:test";
import { DotaDiagnosis, DiagWindow } from "../src/dota/diagnose.js";
import {
  OwnedEngineSessionDependencies,
  runOwnedEngineSession,
} from "../src/dota/engine-owned-session.js";
import { DotaPaths } from "../src/dota/paths.js";
import { VConsoleClient } from "../src/dota/vconsole.js";

const DOTA = {} as DotaPaths;

function diagnosis(blockers: DiagWindow[] = []): DotaDiagnosis {
  return {
    running: true,
    processes: [],
    blocked: blockers.length > 0,
    blockers,
    summary: blockers.length ? "blocked" : "healthy",
  };
}

function stall(): DiagWindow {
  return {
    hwnd: "123",
    visible: true,
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    className: "WatchdogThreadWndClass",
    title: "Stall Detected",
    childTexts: [],
    buttons: [],
    role: "stall",
  };
}

function dialog(): DiagWindow {
  return { ...stall(), hwnd: "456", className: "Dialog", title: "Action required", role: "dialog" };
}

function harness(overrides: Partial<OwnedEngineSessionDependencies> = {}) {
  const calls: string[] = [];
  let connected = false;
  const console = {
    isConnected: () => connected,
    connectWithRetry: async () => { connected = true; calls.push("connect"); },
    recent: () => [{ channel: 0, text: "retained console evidence", at: 1 }],
    disconnect: () => { connected = false; calls.push("disconnect"); },
  } as unknown as VConsoleClient;
  const dependencies: OwnedEngineSessionDependencies = {
    restart: async () => {
      calls.push("restart");
      return { command: "dota", killed: true, reconnected: false, method: "direct", fallbackUsed: false };
    },
    shutdown: async () => {
      calls.push("shutdown");
      return { quitSent: true, forceKilled: false, stopped: true, detail: "closed" };
    },
    processRunning: async () => false,
    consoleForPort: () => console,
    diagnose: async () => { calls.push("diagnose"); return diagnosis(); },
    closeStall: async () => { calls.push("close-stall"); return { closed: true, hwnd: "123" }; },
    waitForWindow: async () => { calls.push("window"); return { requested: true, ok: true, attempts: 1 }; },
    pause: async () => { calls.push("pause"); },
    ...overrides,
  };
  return { calls, dependencies };
}

test("owned engine session launches, prepares, executes, retains evidence, and shuts down", async () => {
  const { calls, dependencies } = harness();
  const result = await runOwnedEngineSession({
    dota: DOTA,
    addon: "fixture",
    map: "fixture_map",
    port: 29000,
  }, async () => {
    calls.push("execute");
    return 42;
  }, dependencies);

  assert.equal(result.fatalError, undefined);
  assert.equal(result.value, 42);
  assert.equal(result.shutdown.stopped, true);
  assert.deepEqual(result.consoleTail, ["retained console evidence"]);
  assert.deepEqual(calls, ["restart", "connect", "diagnose", "window", "execute", "shutdown"]);
});

test("owned engine session closes exact transient stalls before executing", async () => {
  let diagnoses = 0;
  const { calls, dependencies } = harness({
    diagnose: async () => diagnosis(diagnoses++ === 0 ? [stall()] : []),
  });
  const result = await runOwnedEngineSession({
    dota: DOTA,
    addon: "fixture",
    map: "fixture_map",
    port: 29000,
  }, async () => { calls.push("execute"); return "ok"; }, dependencies);

  assert.equal(result.value, "ok");
  assert.equal(result.transientStallDismissals.length, 1);
  assert.deepEqual(calls, ["restart", "connect", "close-stall", "pause", "window", "execute", "shutdown"]);
});

test("owned engine session refuses other blocking dialogs and still shuts down", async () => {
  const { calls, dependencies } = harness({ diagnose: async () => diagnosis([dialog()]) });
  const result = await runOwnedEngineSession({
    dota: DOTA,
    addon: "fixture",
    map: "fixture_map",
    port: 29000,
  }, async () => { calls.push("execute"); return "unsafe"; }, dependencies);

  assert.match(result.fatalError ?? "", /blocked by dialog: Action required/);
  assert.equal(result.startupDiagnosis?.blocked, true);
  assert.equal(result.value, undefined);
  assert.equal(result.shutdown.stopped, true);
  assert.deepEqual(calls, ["restart", "connect", "shutdown"]);
});

test("owned engine session reports a no-op shutdown when launch fails before a process starts", async () => {
  const { calls, dependencies } = harness({
    restart: async () => { calls.push("restart"); throw new Error("launch failed"); },
  });
  const result = await runOwnedEngineSession({
    dota: DOTA,
    addon: "fixture",
    map: "fixture_map",
    port: 29000,
  }, async () => "unreachable", dependencies);

  assert.equal(result.fatalError, "launch failed");
  assert.equal(result.shutdown.stopped, true);
  assert.match(result.shutdown.detail, /never started/);
  assert.deepEqual(calls, ["restart", "disconnect"]);
});

test("owned engine session returns a structured failure when shutdown itself throws", async () => {
  const { calls, dependencies } = harness({
    shutdown: async () => { calls.push("shutdown"); throw new Error("quit transport failed"); },
  });
  const result = await runOwnedEngineSession({
    dota: DOTA,
    addon: "fixture",
    map: "fixture_map",
    port: 29000,
  }, async () => "complete", dependencies);

  assert.equal(result.value, "complete");
  assert.equal(result.shutdown.stopped, false);
  assert.match(result.shutdown.detail, /quit transport failed/);
  assert.deepEqual(calls, ["restart", "connect", "diagnose", "window", "shutdown", "disconnect"]);
});
