import assert from "node:assert/strict";
import test from "node:test";
import { inspectWindowCapturePng } from "../src/dota/capture.js";
import { encodeRgbaPng } from "../src/util/png.js";

function solidPng(width: number, height: number, value: number): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return encodeRgbaPng(width, height, rgba);
}

test("window capture quality rejects a black GPU frame", () => {
  const quality = inspectWindowCapturePng(solidPng(64, 64, 0));
  assert.equal(quality.informative, false);
  assert.equal(quality.lumaRange, 0);
  assert.equal(quality.nonBlackFraction, 0);
});

test("window capture quality accepts a varied rendered frame", () => {
  const width = 64;
  const height = 64;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      rgba[offset] = (x * 4) & 0xff;
      rgba[offset + 1] = (y * 4) & 0xff;
      rgba[offset + 2] = ((x + y) * 2) & 0xff;
      rgba[offset + 3] = 255;
    }
  }
  const quality = inspectWindowCapturePng(encodeRgbaPng(width, height, rgba));
  assert.equal(quality.informative, true);
  assert.ok(quality.lumaRange >= 16);
  assert.ok(quality.lumaStd >= 4);
});
