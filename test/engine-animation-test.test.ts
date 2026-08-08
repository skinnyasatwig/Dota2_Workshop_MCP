import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessBannerFrameMotion,
  assessEngineAnimationSamples,
  buildEngineAnimationCommand,
  buildEngineFocusCommand,
  compareAnimationFrames,
  parseEngineAnimationResponse,
  parseEngineFocusResponse,
  requestEngineAnimationSample,
  requestEngineFocus,
} from "../src/dota/engine-animation-test.js";
import { encodeRgbaPng } from "../src/util/png.js";
import type { VConsoleClient } from "../src/dota/vconsole.js";

function sample(cycle: number, gameTime: number) {
  return {
    targetName: "banner",
    found: true as const,
    classname: "prop_dynamic",
    model: "models/props_teams/banner_radiant.vmdl",
    sequence: "banner_radiant_idle",
    cycle,
    duration: 2,
    finished: false,
    gameTime,
  };
}

function png(width: number, height: number, draw?: (rgba: Buffer) => void): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 32;
    rgba[i * 4 + 1] = 64;
    rgba[i * 4 + 2] = 32;
    rgba[i * 4 + 3] = 255;
  }
  draw?.(rgba);
  return encodeRgbaPng(width, height, rgba);
}

function warmSquare(rgba: Buffer, width: number, x0: number, y0: number, size: number): void {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 220;
      rgba[offset + 1] = 80;
      rgba[offset + 2] = 32;
    }
  }
}

test("animation commands and responses are bounded and correlated", async () => {
  assert.equal(buildEngineAnimationCommand("banner", "request_1"), "mcp_anim request_1 banner");
  assert.throws(() => buildEngineAnimationCommand("bad banner", "request_1"), /may contain only/);
  const line = `[MCP] ANIM_OK request_1 ${JSON.stringify(sample(0.25, 10))}`;
  assert.deepEqual(parseEngineAnimationResponse(line), {
    requestId: "request_1",
    sample: sample(0.25, 10),
  });
  assert.throws(
    () => parseEngineAnimationResponse('[MCP] ANIM_OK request_1 {"found":true}'),
    /wrong shape/,
  );

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
      const [, requestId, targetName] = command.split(" ");
      const response = {
        ...sample(0.5, 11),
        targetName,
      };
      const responseLine = {
        channel: 0,
        text: `[MCP] ANIM_OK ${requestId} ${JSON.stringify(response)}`,
        at: Date.now(),
      };
      queueMicrotask(() => {
        const current = pending;
        if (current) current.resolve(current.testLine(responseLine) ? responseLine : undefined);
      });
    },
  } as unknown as VConsoleClient;
  assert.equal((await requestEngineAnimationSample(fake, "banner", 1000)).cycle, 0.5);

  assert.equal(buildEngineFocusCommand("banner", true, "focus_1"), "mcp_focus focus_1 banner 1");
  const focusPayload = { targetName: "banner", pid: 0, heroHidden: true, origin: [0, 350, 445] };
  assert.deepEqual(
    parseEngineFocusResponse(`[MCP] FOCUS_OK focus_1 ${JSON.stringify(focusPayload)}`),
    { requestId: "focus_1", result: focusPayload },
  );
  assert.throws(
    () => parseEngineFocusResponse('[MCP] FOCUS_OK focus_1 {"targetName":"banner"}'),
    /wrong shape/,
  );

  const focusFake = {
    waitForLine(testLine: (line: { channel: number; text: string; at: number }) => boolean) {
      return new Promise<{ channel: number; text: string; at: number } | undefined>((resolve) => {
        pending = { testLine, resolve };
      });
    },
    send(command: string) {
      const [, requestId, targetName, hidden] = command.split(" ");
      const responseLine = {
        channel: 0,
        text: `[MCP] FOCUS_OK ${requestId} ${JSON.stringify({
          targetName,
          pid: 0,
          heroHidden: hidden === "1",
          origin: [0, 350, 445],
        })}`,
        at: Date.now(),
      };
      queueMicrotask(() => {
        const current = pending;
        if (current) current.resolve(current.testLine(responseLine) ? responseLine : undefined);
      });
    },
  } as unknown as VConsoleClient;
  assert.equal((await requestEngineFocus(focusFake, "banner", true, 1000)).heroHidden, true);
});

test("animation assessment recognizes forward motion and a loop wrap", () => {
  const expectation = {
    targetName: "banner",
    classname: "prop_dynamic",
    model: "models/props_teams/banner_radiant.vmdl",
    sequence: "banner_radiant_idle",
    requireCycleProgress: true,
  };
  const ordinary = assessEngineAnimationSamples([sample(0.1, 10), sample(0.35, 10.5)], expectation);
  assert.equal(ordinary.passed, true);
  assert.ok(ordinary.cycleProgress > 0.24);

  const wrapped = assessEngineAnimationSamples([sample(0.92, 20), sample(0.08, 20.4)], expectation);
  assert.equal(wrapped.passed, true);
  assert.ok(wrapped.cycleProgress > 0.15 && wrapped.cycleProgress < 0.17);

  const stalled = assessEngineAnimationSamples([sample(0.5, 30), sample(0.5, 31)], expectation);
  assert.equal(stalled.passed, false);
  assert.match(stalled.issues[0], /did not advance/);
});

test("renderer comparison isolates warm local motion and rejects still or global changes", () => {
  const width = 160;
  const height = 120;
  const before = png(width, height, (rgba) => warmSquare(rgba, width, 48, 32, 24));
  const after = png(width, height, (rgba) => warmSquare(rgba, width, 54, 32, 24));
  const report = compareAnimationFrames(before, after, { x: 0, y: 0, width: 1, height: 1 });
  assert.ok(report.changedPixels >= 200);
  assert.ok(report.warmChangedPixels >= 200);
  assert.equal(assessBannerFrameMotion(report).passed, true);
  assert.equal(
    assessBannerFrameMotion(report, { minimumWarmEligiblePixels: 10_000 }).passed,
    false,
  );

  const still = compareAnimationFrames(before, before, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(assessBannerFrameMotion(still).passed, false);
  assert.match(assessBannerFrameMotion(still).issues.join(" "), /Too little renderer motion/);

  const global = compareAnimationFrames(
    png(width, height),
    png(width, height, (rgba) => {
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = 220;
        rgba[i * 4 + 1] = 60;
        rgba[i * 4 + 2] = 20;
      }
    }),
    { x: 0, y: 0, width: 1, height: 1 },
  );
  assert.equal(assessBannerFrameMotion(global).passed, false);
  assert.match(assessBannerFrameMotion(global).issues.join(" "), /Too much/);
  assert.throws(
    () => compareAnimationFrames(before, png(80, 60), { x: 0, y: 0, width: 1, height: 1 }),
    /different dimensions/,
  );
});
