import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEngineNavigationCommand,
  ensureEngineNavigationMapReady,
  engineNavigationRepairSuggestions,
  engineNavigationRoutesFromManagedPaths,
  executeEngineNavigationChecks,
  parseEngineNavigationLine,
  validateEngineNavigationRoutes,
  waitForEngineNavigationReady,
} from "../src/dota/engine-nav-test.js";
import type { VConsoleClient } from "../src/dota/vconsole.js";

test("managed paths become bounded engine navigation routes", () => {
  const routes = engineNavigationRoutesFromManagedPaths([
    {
      name: "radiant_north",
      points: [
        [-1024, 256, 128],
        [0, 256, 128],
        [1024, 256, 128],
      ],
    },
  ]);
  assert.deepEqual(routes[0].points[1], [0, 256, 128]);
  const command = buildEngineNavigationCommand(routes[0], "both");
  assert.match(command, /^mcp_nav nav radiant_north both /);
  assert.match(command, /radiant_north/);
  assert.ok(command.length < 480);
});

test("route validation rejects duplicates, unsafe names, and oversized routes", () => {
  assert.throws(
    () =>
      validateEngineNavigationRoutes([
        { name: "same", points: [[0, 0, 0], [1, 0, 0]] },
        { name: "same", points: [[0, 1, 0], [1, 1, 0]] },
      ]),
    /duplicated/,
  );
  assert.throws(
    () => validateEngineNavigationRoutes([{ name: "bad name", points: [[0, 0, 0], [1, 0, 0]] }]),
    /may contain only/,
  );
  assert.throws(
    () =>
      validateEngineNavigationRoutes([
        {
          name: "too_long",
          points: Array.from({ length: 129 }, (_, index) => [index, 0, 0] as [number, number, number]),
        },
      ]),
    /more than 128 points/,
  );
});

test("structured DebugSDK navigation output is parsed strictly", () => {
  const payload = {
    name: "radiant_north",
    mode: "both",
    pointCount: 2,
    endpoint: {
      from: [-512, 256, 128],
      to: [512, 256, 128],
      startTraversable: true,
      endTraversable: true,
      canFindPath: true,
      pathLength: 1024,
      passed: true,
    },
    segments: [
      {
        index: 1,
        from: [-512, 256, 128],
        to: [512, 256, 128],
        startTraversable: true,
        endTraversable: true,
        canFindPath: true,
        pathLength: 1024,
        passed: true,
      },
    ],
    passed: true,
  };
  const parsed = parseEngineNavigationLine(`[MCP] NAV_OK request_1 ${JSON.stringify(payload)}`);
  assert.equal(parsed.passed, true);
  assert.equal(parsed.segments[0].pathLength, 1024);
  assert.throws(() => parseEngineNavigationLine("[MCP] NAV_OK request_1 {}"), /wrong shape/);

  const segmentOnly = { ...payload, mode: "segments", endpoint: undefined };
  const normalized = parseEngineNavigationLine(`[MCP] NAV_OK request_2 ${JSON.stringify(segmentOnly)}`);
  assert.equal(normalized.endpoint, null);
});

test("navigation execution chunks routes below the console limit and correlates responses", async () => {
  const points = Array.from(
    { length: 16 },
    (_, index) => [index * 256, index % 2 === 0 ? 512 : 768, 128] as [number, number, number],
  );
  const sent: string[] = [];
  let pending:
    | {
        testLine: (line: { channel: number; text: string; at: number }) => boolean;
        resolve: (line: { channel: number; text: string; at: number } | undefined) => void;
      }
    | undefined;
  const fake = {
    waitForLine(testLine: (line: { channel: number; text: string; at: number }) => boolean) {
      return new Promise<{ channel: number; text: string; at: number } | undefined>((resolve) => {
        pending = { testLine, resolve };
      });
    },
    send(command: string) {
      sent.push(command);
      const [, requestId, name, mode, encoded] = command.split(" ");
      const chunkPoints = encoded.slice(1, -1).split(":").map((point) => point.split(",").map(Number));
      const check = (from: number[], to: number[], index?: number) => ({
        ...(index === undefined ? {} : { index }),
        from,
        to,
        startTraversable: true,
        endTraversable: true,
        canFindPath: true,
        pathLength: 256,
        passed: true,
      });
      const endpoint = mode === "segments" ? null : check(chunkPoints[0], chunkPoints.at(-1)!);
      const segments =
        mode === "endpoints"
          ? []
          : chunkPoints.slice(0, -1).map((point, index) => check(point, chunkPoints[index + 1], index + 1));
      const payload = {
        name,
        mode,
        pointCount: chunkPoints.length,
        endpoint,
        segments,
        passed: true,
      };
      const line = { channel: 0, text: `[MCP] NAV_OK ${requestId} ${JSON.stringify(payload)}`, at: Date.now() };
      queueMicrotask(() => {
        const current = pending;
        if (current) current.resolve(current.testLine(line) ? line : undefined);
      });
    },
  } as unknown as VConsoleClient;

  const execution = await executeEngineNavigationChecks(fake, [{ name: "long_route", points }], "both", 1000);
  assert.equal(execution.failures.length, 0);
  assert.equal(execution.results.length, 1);
  assert.equal(execution.results[0].segments.length, 15);
  assert.deepEqual(
    execution.results[0].segments.map((segment) => segment.index),
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
  assert.ok(sent.length > 1);
  assert.ok(sent.every((command) => command.length < 480));
});

test("blocked route endpoints collapse into one nearest-reachable repair suggestion", () => {
  const failedPoint: [number, number, number] = [0, 768, 128];
  const suggestedPoint: [number, number, number] = [64, 704, 128];
  const suggestion = { point: suggestedPoint, gridOffset: [1, -1], distance: 90.51 };
  const result = parseEngineNavigationLine(
    `[MCP] NAV_OK repair_1 ${JSON.stringify({
      name: "north_lane",
      mode: "segments",
      pointCount: 3,
      endpoint: null,
      segments: [
        {
          index: 1,
          from: [-512, 768, 128],
          to: failedPoint,
          startTraversable: true,
          endTraversable: false,
          canFindPath: false,
          pathLength: -1,
          passed: false,
          nearestEnd: suggestion,
        },
        {
          index: 2,
          from: failedPoint,
          to: [512, 768, 128],
          startTraversable: false,
          endTraversable: true,
          canFindPath: false,
          pathLength: -1,
          passed: false,
          nearestStart: suggestion,
        },
      ],
      passed: false,
    })}`,
  );

  const repairs = engineNavigationRepairSuggestions([result]);
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0].originalPoint, failedPoint);
  assert.deepEqual(repairs[0].suggestedPoint, suggestedPoint);
  assert.deepEqual(repairs[0].references, ["segment 1 end", "segment 2 start"]);
});

test("traversable but disconnected endpoints still produce repair suggestions", () => {
  const failedPoint: [number, number, number] = [0, 384, 128];
  const suggestedPoint: [number, number, number] = [32, 352, 128];
  const result = parseEngineNavigationLine(
    `[MCP] NAV_OK disconnected_1 ${JSON.stringify({
      name: "sealed_gate",
      mode: "segments",
      pointCount: 2,
      endpoint: null,
      segments: [{
        index: 1,
        from: failedPoint,
        to: [384, 384, 128],
        startTraversable: true,
        endTraversable: true,
        canFindPath: false,
        pathLength: -1,
        passed: false,
        nearestStart: { point: suggestedPoint, gridOffset: [1, -1], distance: 45.25 },
      }],
      passed: false,
    })}`,
  );

  const repairs = engineNavigationRepairSuggestions([result]);
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0].originalPoint, failedPoint);
  assert.deepEqual(repairs[0].suggestedPoint, suggestedPoint);
  assert.deepEqual(repairs[0].references, ["segment 1 disconnected start"]);
});

test("readiness reports the last observed DebugSDK state", async () => {
  const states = [1, 3];
  let pending:
    | {
        testLine: (line: { channel: number; text: string; at: number }) => boolean;
        resolve: (line: { channel: number; text: string; at: number } | undefined) => void;
      }
    | undefined;
  const fake = {
    send(command: string) {
      const requestId = command.split(" ")[1];
      const state = states.shift();
      const line = {
        channel: 0,
        text: `[MCP] PONG v=1.1.1 t=1 state=${state} request=${requestId}`,
        at: Date.now(),
      };
      queueMicrotask(() => {
        const current = pending;
        if (current) current.resolve(current.testLine(line) ? line : undefined);
      });
    },
    waitForLine(testLine: (line: { channel: number; text: string; at: number }) => boolean) {
      return new Promise<{ channel: number; text: string; at: number } | undefined>((resolve) => {
        pending = { testLine, resolve };
      });
    },
  } as unknown as VConsoleClient;
  const ready = await waitForEngineNavigationReady(fake, 3, 1000);
  assert.equal(ready.ready, true);
  assert.equal(ready.pongCount, 2);
  assert.match(ready.lastPong ?? "", /state=3/);
});

test("map readiness explicitly loads the custom game after a bounded empty grace period", async () => {
  const sent: string[] = [];
  const waits = [
    { ready: false, lastPong: undefined, pongCount: 0 },
    { ready: true, line: "[MCP] PONG state=4", lastPong: "[MCP] PONG state=4", pongCount: 1 },
  ];
  const fake = { send: (command: string) => sent.push(command) } as unknown as VConsoleClient;
  const result = await ensureEngineNavigationMapReady(
    fake,
    "dota_three_vs_three",
    "three_vs_three_blockout",
    3,
    120_000,
    5000,
    async () => waits.shift()!,
  );

  assert.equal(result.ready, true);
  assert.equal(result.mapLaunchCommandSent, true);
  assert.deepEqual(sent, ["dota_launch_custom_game dota_three_vs_three three_vs_three_blockout"]);
  assert.equal(result.pongCount, 1);
});

test("map readiness does not reload a map that answers during the grace period", async () => {
  const sent: string[] = [];
  const fake = { send: (command: string) => sent.push(command) } as unknown as VConsoleClient;
  const result = await ensureEngineNavigationMapReady(
    fake,
    "dota_three_vs_three",
    "three_vs_three_blockout",
    3,
    120_000,
    5000,
    async () => ({ ready: true, line: "ready", lastPong: "ready", pongCount: 1 }),
  );

  assert.equal(result.ready, true);
  assert.equal(result.mapLaunchCommandSent, false);
  assert.deepEqual(sent, []);
});
