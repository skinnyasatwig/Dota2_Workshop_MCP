import { z } from "zod";
import {
  MapOverviewImageSize,
  MapOverviewMetadata,
  mapOverviewDisplayUvToWorld,
} from "./map-overview.js";
import { VConsoleClient } from "./vconsole.js";

export interface MinimapProbe {
  name: string;
  u: number;
  v: number;
}

export interface MinimapClientRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraTelemetry {
  camera: { x: number; y: number; z: number };
  screen: { width: number; height: number };
  minimap: {
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    uiScaleX?: number;
    uiScaleY?: number;
  };
}

export const DOTA_GAME_STATE_HERO_SELECTION = 3;
export const DEFAULT_VISUAL_READY_GAME_STATE = 7;

/**
 * State 6 (PRE_GAME) can still be Valve's full-screen team showcase. Visual
 * evidence defaults to state 7 so renderer pixels and minimap input target the
 * actual map. Lower states remain an explicit diagnostic override.
 */
export function resolveVisualReadyGameState(requested?: number): number {
  const resolved = requested ?? DEFAULT_VISUAL_READY_GAME_STATE;
  if (!Number.isInteger(resolved) || resolved < 3 || resolved > 9) {
    throw new Error("Visual ready game state must be an integer from 3 through 9.");
  }
  return resolved;
}

const finite = z.number().finite();
const telemetrySchema = z.object({
  camera: z.object({ x: finite, y: finite, z: finite }).strict(),
  screen: z.object({ width: finite.positive(), height: finite.positive() }).strict(),
  minimap: z.object({
    id: z.string().optional(),
    x: finite,
    y: finite,
    width: finite.nonnegative(),
    height: finite.nonnegative(),
    uiScaleX: finite.positive().optional(),
    uiScaleY: finite.positive().optional(),
  }).strict(),
}).strict();

export const DEFAULT_MINIMAP_PROBES: readonly MinimapProbe[] = [
  { name: "west", u: 0.2, v: 0.5 },
  { name: "center", u: 0.5, v: 0.5 },
  { name: "east", u: 0.8, v: 0.5 },
  { name: "north", u: 0.5, v: 0.2 },
  { name: "south", u: 0.5, v: 0.8 },
];

let cameraRequestSequence = 0;

export function validateMinimapProbes(probes: readonly MinimapProbe[]): MinimapProbe[] {
  if (!probes.length) throw new Error("A visual minimap test needs at least one probe.");
  if (probes.length > 16) throw new Error("A visual minimap test supports at most 16 probes per launch.");
  const names = new Set<string>();
  return probes.map((probe, index) => {
    if (!/^[A-Za-z0-9_.:-]+$/.test(probe.name)) {
      throw new Error(`Probe ${index} has an unsafe or empty name.`);
    }
    if (names.has(probe.name)) throw new Error(`Probe name is duplicated: ${probe.name}`);
    names.add(probe.name);
    if (![probe.u, probe.v].every(Number.isFinite) || probe.u < 0 || probe.u > 1 || probe.v < 0 || probe.v > 1) {
      throw new Error(`Probe "${probe.name}" must use normalized u/v coordinates from 0 through 1.`);
    }
    return { name: probe.name, u: probe.u, v: probe.v };
  });
}

export function parseCameraTelemetryResponse(line: string): { requestId: string; telemetry: CameraTelemetry } {
  const marker = "[MCP] CAMERA_OK ";
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) throw new Error(`DebugSDK did not return CAMERA_OK: ${line}`);
  const payload = line.slice(markerIndex + marker.length);
  const separator = payload.indexOf(" ");
  if (separator < 1) throw new Error(`DebugSDK CAMERA_OK response omitted its request id: ${line}`);
  const requestId = payload.slice(0, separator);
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.slice(separator + 1).trim());
  } catch (error) {
    throw new Error(`DebugSDK returned invalid camera JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = telemetrySchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(`DebugSDK camera result had the wrong shape: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { requestId, telemetry: parsed.data };
}

export function minimapRectFromTelemetry(
  telemetry: CameraTelemetry,
  client: { width: number; height: number },
): MinimapClientRect {
  if (!(telemetry.minimap.width > 0) || !(telemetry.minimap.height > 0)) {
    throw new Error(
      "The camera bridge could not find a visible native minimap panel. Its Valve panel id may have changed; pass minimapRect explicitly or update the bridge candidates.",
    );
  }
  if (!(client.width > 0) || !(client.height > 0)) throw new Error("Dota reported an invalid client size.");
  const scaleX = client.width / telemetry.screen.width;
  const scaleY = client.height / telemetry.screen.height;
  return {
    x: telemetry.minimap.x * scaleX,
    y: telemetry.minimap.y * scaleY,
    width: telemetry.minimap.width * scaleX,
    height: telemetry.minimap.height * scaleY,
  };
}

export function minimapProbePixel(rect: MinimapClientRect, probe: MinimapProbe): { x: number; y: number } {
  return {
    x: Math.round(rect.x + rect.width * probe.u),
    y: Math.round(rect.y + rect.height * probe.v),
  };
}

export function minimapProbeWorld(
  metadata: Pick<MapOverviewMetadata, "posX" | "posY" | "scale" | "rotate">,
  image: MapOverviewImageSize,
  probe: MinimapProbe,
): { x: number; y: number } {
  return mapOverviewDisplayUvToWorld(metadata, image, probe);
}

export function cameraErrorDistance(
  expected: { x: number; y: number },
  actual: { x: number; y: number },
): number {
  return Math.hypot(actual.x - expected.x, actual.y - expected.y);
}

export async function requestCameraTelemetry(
  vc: VConsoleClient,
  timeoutMs = 5000,
  playerId?: number,
): Promise<{ requestId: string; telemetry: CameraTelemetry; consoleLine: string }> {
  const requestId = `camera_${Date.now().toString(36)}_${(cameraRequestSequence++).toString(36)}`;
  const okMarker = `[MCP] CAMERA_OK ${requestId} `;
  const errorMarker = `[MCP] CAMERA_ERR ${requestId} `;
  const response = vc.waitForLine(
    (line) => line.text.includes(okMarker) || line.text.includes(errorMarker),
    timeoutMs,
  );
  vc.send(`mcp_camera ${requestId}${playerId === undefined ? "" : ` ${playerId}`}`);
  const line = await response;
  if (!line) throw new Error(`No correlated camera response for ${requestId} within ${timeoutMs}ms.`);
  if (line.text.includes(errorMarker)) throw new Error(`DebugSDK camera query failed: ${line.text}`);
  const parsed = parseCameraTelemetryResponse(line.text);
  if (parsed.requestId !== requestId) {
    throw new Error(`Expected camera request "${requestId}" but DebugSDK returned "${parsed.requestId}".`);
  }
  return { requestId, telemetry: parsed.telemetry, consoleLine: line.text };
}
