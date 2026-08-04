import { test } from "node:test";
import assert from "node:assert/strict";
import {
  explainEngineReadiness,
  engineStartupFatalReason,
  observeEngineReadiness,
  parseEngineReadinessPong,
  selectEngineReadinessSignals,
} from "../src/dota/engine-readiness.js";
import type { VConsoleClient } from "../src/dota/vconsole.js";

test("DebugSDK pongs expose game state and optional game time", () => {
  assert.deepEqual(parseEngineReadinessPong("[MCP] PONG v=1.0.0 t=-1.25 state=2"), {
    state: 2,
    gameTime: -1.25,
    line: "[MCP] PONG v=1.0.0 t=-1.25 state=2",
  });
  assert.deepEqual(parseEngineReadinessPong("prefix [MCP] PONG state=3"), {
    state: 3,
    gameTime: undefined,
    line: "prefix [MCP] PONG state=3",
  });
  assert.equal(parseEngineReadinessPong("[MCP] DebugSDK loaded"), undefined);
  assert.equal(parseEngineReadinessPong("PONG state=3"), undefined);
});

test("readiness observation records state transitions and stops at the target", async () => {
  const lines = [
    { channel: 0, text: "[MCP] PONG v=1.0.0 t=0 state=1", at: 1 },
    { channel: 0, text: "[MCP] PONG v=1.0.0 t=1 state=1", at: 2 },
    { channel: 0, text: "[MCP] PONG v=1.0.0 t=2 state=2", at: 3 },
    { channel: 0, text: "[MCP] PONG v=1.0.0 t=3 state=3", at: 4 },
  ];
  const fake = {
    send(command: string) {
      assert.equal(command, "mcp_ping");
    },
    async waitForLine(testLine: (line: (typeof lines)[number]) => boolean) {
      const line = lines.shift();
      return line && testLine(line) ? line : undefined;
    },
  } as unknown as VConsoleClient;

  const result = await observeEngineReadiness(fake, 3, 1500, 250);
  assert.equal(result.ready, true);
  assert.equal(result.pongCount, 4);
  assert.equal(result.highestState, 3);
  assert.deepEqual(result.timeline.map((sample) => sample.state), [1, 2, 3]);
  assert.match(explainEngineReadiness(result), /reached game state 3/);
});

test("signal selection keeps useful evidence, removes adjacent duplicates, and caps output", () => {
  const selected = selectEngineReadinessSignals(
    [
      { text: "irrelevant material message" },
      { text: "Loading map three_vs_three_blockout" },
      { text: "Loading map three_vs_three_blockout" },
      { text: "[MCP] PONG state=1" },
      { text: "Script error: bad bootstrap" },
    ],
    2,
  );
  assert.deepEqual(selected, ["[MCP] PONG state=1", "Script error: bad bootstrap"]);
  assert.match(
    explainEngineReadiness(
      {
        ready: false,
        targetGameState: 3,
        durationMs: 1000,
        pongCount: 2,
        highestState: 1,
        timeline: [],
      },
      false,
    ),
    /remained below game state 3/,
  );
  assert.match(explainEngineReadiness(undefined, true), /blocking dialog/);
});

test("fatal startup evidence ends a readiness observation immediately", async () => {
  assert.match(engineStartupFatalReason("Driver error: NVAPI_ACCESS_DENIED") ?? "", /NVIDIA/);
  const line = {
    channel: 0,
    text: "Failed to initialize NVidia driver! Driver error: NVAPI_ACCESS_DENIED",
    at: 1,
  };
  const fake = {
    send() {},
    async waitForLine(testLine: (candidate: typeof line) => boolean) {
      return testLine(line) ? line : undefined;
    },
  } as unknown as VConsoleClient;
  const result = await observeEngineReadiness(fake, 3, 60_000, 1000);
  assert.equal(result.ready, false);
  assert.equal(result.pongCount, 0);
  assert.match(result.stoppedReason ?? "", /NVIDIA/);
  assert.ok(result.durationMs < 1000);
});
