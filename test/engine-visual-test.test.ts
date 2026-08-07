import assert from "node:assert/strict";
import test from "node:test";
import {
  cameraErrorDistance,
  minimapProbePixel,
  minimapProbeWorld,
  minimapRectFromTelemetry,
  parseCameraTelemetryResponse,
  validateMinimapProbes,
} from "../src/dota/engine-visual-test.js";

test("camera telemetry is correlated and strictly parsed", () => {
  const line = '[MCP] CAMERA_OK request_1 {"camera":{"x":10,"y":20,"z":30},"screen":{"width":1920,"height":1080},"minimap":{"id":"minimap","x":8,"y":816,"width":252,"height":252,"uiScaleX":1,"uiScaleY":1}}';
  const parsed = parseCameraTelemetryResponse(line);
  assert.equal(parsed.requestId, "request_1");
  assert.deepEqual(parsed.telemetry.camera, { x: 10, y: 20, z: 30 });
  assert.equal(parsed.telemetry.minimap.id, "minimap");
  assert.throws(() => parseCameraTelemetryResponse("[MCP] CAMERA_ERR request_1 nope"), /did not return CAMERA_OK/);
});

test("minimap geometry scales from Panorama screen pixels into the Dota client", () => {
  const rect = minimapRectFromTelemetry({
    camera: { x: 0, y: 0, z: 0 },
    screen: { width: 1920, height: 1080 },
    minimap: { id: "minimap", x: 8, y: 816, width: 252, height: 252 },
  }, { width: 1280, height: 720 });
  assert.deepEqual(rect, { x: 16 / 3, y: 544, width: 168, height: 168 });
  assert.deepEqual(minimapProbePixel(rect, { name: "center", u: 0.5, v: 0.5 }), { x: 89, y: 628 });
});

test("minimap UVs map north-up into world coordinates and report camera error", () => {
  const bounds = { minX: -8192, minY: -4096, maxX: 8192, maxY: 4096 };
  assert.deepEqual(minimapProbeWorld(bounds, { name: "northwest", u: 0.25, v: 0.25 }), { x: -4096, y: 2048 });
  assert.equal(cameraErrorDistance({ x: -4096, y: 2048 }, { x: -4000, y: 1976 }), 120);
});

test("minimap probes reject duplicate, unsafe, and out-of-range inputs", () => {
  assert.equal(validateMinimapProbes([{ name: "center", u: 0.5, v: 0.5 }]).length, 1);
  assert.throws(() => validateMinimapProbes([]), /at least one/);
  assert.throws(() => validateMinimapProbes([{ name: "bad name", u: 0.5, v: 0.5 }]), /unsafe/);
  assert.throws(() => validateMinimapProbes([{ name: "bad", u: 1.5, v: 0.5 }]), /0 through 1/);
});
