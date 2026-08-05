import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareAttachedEngineWindow } from "../src/dota/engine-window.js";
import type { Win32Spec } from "../src/dota/win32.js";

test("attached engine window preparation restores and focuses Dota", async () => {
  let received: Win32Spec | undefined;
  const result = await prepareAttachedEngineWindow(true, async (spec) => {
    received = spec;
    return { ok: true, foreground: true, minimized: false, performed: ["focus"] };
  });

  assert.deepEqual(received, { focus: false, window: { action: "focus" } });
  assert.equal(result.ok, true);
  assert.equal(result.result?.foreground, true);
});

test("attached engine window preparation can be explicitly skipped", async () => {
  let called = false;
  const result = await prepareAttachedEngineWindow(false, async () => {
    called = true;
    return { ok: true };
  });

  assert.equal(called, false);
  assert.deepEqual(result, { requested: false, ok: true });
});

test("attached engine window preparation reports focus failures", async () => {
  const result = await prepareAttachedEngineWindow(true, async () => ({
    ok: false,
    error: "no Dota window",
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error, "no Dota window");
});
