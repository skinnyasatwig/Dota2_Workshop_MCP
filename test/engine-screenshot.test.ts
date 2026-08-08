import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureEngineScreenshot, inspectJpeg } from "../src/dota/engine-screenshot.js";
import { encodeRgbaPng } from "../src/util/png.js";

function syntheticJpeg(width = 128, height = 64): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function variedPng(width = 32, height = 32): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      rgba[offset] = x * 8;
      rgba[offset + 1] = y * 8;
      rgba[offset + 2] = (x + y) * 4;
      rgba[offset + 3] = 255;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

function solidPng(value: number): Buffer {
  const rgba = Buffer.alloc(32 * 32 * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return encodeRgbaPng(32, 32, rgba);
}

test("JPEG inspection reads dimensions and rejects mislabeled data", () => {
  assert.deepEqual(inspectJpeg(syntheticJpeg(1920, 1080)), { width: 1920, height: 1080 });
  assert.throws(() => inspectJpeg(Buffer.from("not a jpeg")), /missing SOI/);
});

test("engine screenshot accepts only a new stable JPEG and retains the source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-shot-test-"));
  try {
    const existing = join(dir, "existing.jpg");
    await writeFile(existing, syntheticJpeg(10, 10));
    const commands: string[] = [];
    const result = await captureEngineScreenshot({
      screenshotsDir: dir,
      format: "jpeg",
      quality: 88,
      timeoutMs: 1000,
      pollIntervalMs: 5,
      sendCommand: (command) => {
        commands.push(command);
        setTimeout(() => void writeFile(join(dir, "new-shot.jpg"), syntheticJpeg()), 10);
        return ["Screenshot async write queued"];
      },
      convertToPng: async () => variedPng(),
    });
    assert.deepEqual(commands, ["jpeg_screenshot \"\" 88"]);
    assert.deepEqual(result.commandOutput, ["Screenshot async write queued"]);
    assert.equal(result.correlated, true);
    assert.equal(result.retained, true);
    assert.equal(result.sourceName, "new-shot.jpg");
    assert.deepEqual(result.dimensions, { width: 128, height: 64 });
    assert.equal(result.quality?.informative, true);
    assert.ok(result.buf?.length);
    await access(result.sourcePath!);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine screenshot times out instead of accepting a pre-existing image", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-shot-timeout-"));
  try {
    await writeFile(join(dir, "old.jpg"), syntheticJpeg());
    let clock = 0;
    const result = await captureEngineScreenshot({
      screenshotsDir: dir,
      format: "jpeg",
      timeoutMs: 20,
      pollIntervalMs: 5,
      sendCommand: () => {},
      sleep: async (milliseconds) => { clock += milliseconds; },
      now: () => clock,
      convertToPng: async () => variedPng(),
    });
    assert.equal(result.correlated, false);
    assert.match(result.error ?? "", /did not create a new stable JPEG/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine screenshot rejects a correlated blank frame", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-shot-blank-"));
  try {
    const result = await captureEngineScreenshot({
      screenshotsDir: dir,
      format: "jpeg",
      timeoutMs: 1000,
      pollIntervalMs: 5,
      sendCommand: () => {
        setTimeout(() => void writeFile(join(dir, "blank.jpg"), syntheticJpeg()), 10);
      },
      convertToPng: async () => solidPng(0),
    });
    assert.equal(result.correlated, true);
    assert.equal(result.buf, undefined);
    assert.equal(result.quality?.informative, false);
    assert.match(result.error ?? "", /uninformative frame/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine screenshot defaults to Source 2 PNG and needs no external decoder", async () => {
  const dir = await mkdtemp(join(tmpdir(), "engine-shot-png-"));
  try {
    const commands: string[] = [];
    const result = await captureEngineScreenshot({
      screenshotsDir: dir,
      timeoutMs: 1000,
      pollIntervalMs: 5,
      sendCommand: (command) => {
        commands.push(command);
        setTimeout(() => void writeFile(join(dir, "source2-shot.png"), variedPng()), 10);
      },
    });
    assert.deepEqual(commands, ["png_screenshot"]);
    assert.equal(result.sourceFormat, "png");
    assert.equal(result.correlated, true);
    assert.deepEqual(result.dimensions, { width: 32, height: 32 });
    assert.ok(result.buf?.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
