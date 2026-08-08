// Bounded runtime checks for animated map props. Structured samples come from the
// DebugSDK's correlated mcp_anim command; renderer proof compares only a declared
// region and reports warm-colour motion separately for the team-banner fixture.

import { z } from "zod";
import { decodePng } from "../util/imgmontage.js";
import type { VConsoleClient } from "./vconsole.js";

const foundSampleSchema = z.object({
  targetName: z.string().min(1),
  found: z.literal(true),
  classname: z.string().min(1),
  model: z.string().min(1),
  sequence: z.string().min(1),
  cycle: z.number().finite(),
  duration: z.number().finite().optional(),
  finished: z.boolean().optional(),
  gameTime: z.number().finite(),
}).strict();

const missingSampleSchema = z.object({
  targetName: z.string().min(1),
  found: z.literal(false),
  gameTime: z.number().finite(),
}).strict();

export const engineAnimationSampleSchema = z.discriminatedUnion("found", [
  foundSampleSchema,
  missingSampleSchema,
]);

export type EngineAnimationSample = z.infer<typeof engineAnimationSampleSchema>;

const engineFocusResultSchema = z.object({
  targetName: z.string().min(1),
  pid: z.number().int().min(0).max(23),
  heroHidden: z.boolean(),
  origin: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
}).strict();

export type EngineFocusResult = z.infer<typeof engineFocusResultSchema>;

const engineFrameSettingsSchema = z.object({
  distance: z.number().finite().min(400).max(5000),
  yaw: z.number().finite().min(-360).max(360),
  pitch: z.number().finite().min(20).max(89),
  heightOffset: z.number().finite().min(-2048).max(2048),
}).strict();

const engineFrameRequestSettingsSchema = engineFrameSettingsSchema.extend({
  hideHero: z.boolean().optional(),
}).strict();

const engineFrameResultSchema = z.object({
  targetName: z.string().min(1),
  pid: z.number().int().min(0).max(23),
  heroHidden: z.boolean(),
  origin: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  focusPoint: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  lookAt: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  camera: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  screenUv: z.tuple([z.number().finite(), z.number().finite()]),
  settings: engineFrameSettingsSchema,
}).strict();

export type EngineFrameSettings = z.infer<typeof engineFrameRequestSettingsSchema>;

export type EngineFrameResult = z.infer<typeof engineFrameResultSchema>;

export interface EngineFrameAssessment {
  passed: boolean;
  targetMatched: boolean;
  focusVisible: boolean;
  lookAtError: number;
  issues: string[];
}

export interface EngineAnimationExpectation {
  targetName: string;
  classname?: string;
  model?: string;
  sequence?: string;
  requireCycleProgress?: boolean;
  minimumCycleProgress?: number;
}

export interface EngineAnimationAssessment {
  passed: boolean;
  entityPassed: boolean;
  cycleProgressRequired: boolean;
  cycleProgressed: boolean;
  cycleProgress: number;
  elapsedGameTime: number;
  issues: string[];
}

export interface NormalizedFrameRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameMotionReport {
  width: number;
  height: number;
  region: { x: number; y: number; width: number; height: number };
  threshold: number;
  sampledPixels: number;
  changedPixels: number;
  changedFraction: number;
  meanAbsoluteDelta: number;
  meanChangedDelta: number;
  warmEligiblePixels: number;
  warmChangedPixels: number;
  warmChangedFraction: number;
  changedBounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface FrameMotionAssessment {
  passed: boolean;
  issues: string[];
  report: FrameMotionReport;
}

export interface BannerFrameMotionThresholds {
  minimumWarmEligiblePixels?: number;
  minimumWarmChangedPixels?: number;
  minimumWarmChangedFraction?: number;
}

let animationRequestSequence = 0;
let focusRequestSequence = 0;
let frameRequestSequence = 0;

function safeToken(value: string, label: string): string {
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new Error(`${label} may contain only letters, digits, _, ., :, and -.`);
  }
  return value;
}

function normalizedResource(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

/** Build one compact request whose response can be distinguished from stale console output. */
export function buildEngineAnimationCommand(targetName: string, requestId = "anim"): string {
  return `mcp_anim ${safeToken(requestId, "Animation request id")} ${safeToken(targetName, "Animation targetname")}`;
}

export function parseEngineAnimationResponse(
  line: string,
): { requestId: string; sample: EngineAnimationSample } {
  const marker = "[MCP] ANIM_OK ";
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) throw new Error(`DebugSDK did not return ANIM_OK: ${line}`);
  const payload = line.slice(markerIndex + marker.length);
  const separator = payload.indexOf(" ");
  if (separator < 1) throw new Error(`DebugSDK ANIM_OK response omitted its request id: ${line}`);
  const requestId = payload.slice(0, separator);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.slice(separator + 1).trim());
  } catch (error) {
    throw new Error(`DebugSDK returned invalid animation JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const sample = engineAnimationSampleSchema.safeParse(parsed);
  if (!sample.success) {
    throw new Error(`DebugSDK animation sample had the wrong shape: ${sample.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { requestId, sample: sample.data };
}

/** Query one named entity and wait only for this request's correlated response. */
export async function requestEngineAnimationSample(
  vc: VConsoleClient,
  targetName: string,
  timeoutMs = 5000,
): Promise<EngineAnimationSample> {
  const requestId = `anim_${Date.now().toString(36)}_${(animationRequestSequence++).toString(36)}`;
  const wait = vc.waitForLine(
    (line) =>
      (line.text.includes(`[MCP] ANIM_OK ${requestId} `) ||
        line.text.includes(`[MCP] ANIM_ERR ${requestId} `)),
    timeoutMs,
  );
  vc.send(buildEngineAnimationCommand(targetName, requestId));
  const line = await wait;
  if (!line) throw new Error(`DebugSDK did not answer animation request ${requestId} within ${timeoutMs}ms.`);
  if (line.text.includes(`[MCP] ANIM_ERR ${requestId} `)) {
    throw new Error(line.text.slice(line.text.indexOf(`[MCP] ANIM_ERR ${requestId} `) + `[MCP] ANIM_ERR ${requestId} `.length));
  }
  return parseEngineAnimationResponse(line.text).sample;
}

export function buildEngineFocusCommand(
  targetName: string,
  hideHero = false,
  requestId = "focus",
): string {
  return `mcp_focus ${safeToken(requestId, "Focus request id")} ${safeToken(targetName, "Focus targetname")} ${hideHero ? 1 : 0}`;
}

export function parseEngineFocusResponse(line: string): { requestId: string; result: EngineFocusResult } {
  const marker = "[MCP] FOCUS_OK ";
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) throw new Error(`DebugSDK did not return FOCUS_OK: ${line}`);
  const payload = line.slice(markerIndex + marker.length);
  const separator = payload.indexOf(" ");
  if (separator < 1) throw new Error(`DebugSDK FOCUS_OK response omitted its request id: ${line}`);
  const requestId = payload.slice(0, separator);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.slice(separator + 1).trim());
  } catch (error) {
    throw new Error(`DebugSDK returned invalid focus JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = engineFocusResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`DebugSDK focus result had the wrong shape: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { requestId, result: result.data };
}

/** Apply the legacy server-side camera target; use requestEngineFrame for exact framing controls. */
export async function requestEngineFocus(
  vc: VConsoleClient,
  targetName: string,
  hideHero = false,
  timeoutMs = 5000,
): Promise<EngineFocusResult> {
  const requestId = `focus_${Date.now().toString(36)}_${(focusRequestSequence++).toString(36)}`;
  const okMarker = `[MCP] FOCUS_OK ${requestId} `;
  const errorMarker = `[MCP] FOCUS_ERR ${requestId} `;
  const wait = vc.waitForLine(
    (line) => line.text.includes(okMarker) || line.text.includes(errorMarker),
    timeoutMs,
  );
  vc.send(buildEngineFocusCommand(targetName, hideHero, requestId));
  const line = await wait;
  if (!line) throw new Error(`DebugSDK did not answer focus request ${requestId} within ${timeoutMs}ms.`);
  if (line.text.includes(errorMarker)) {
    throw new Error(line.text.slice(line.text.indexOf(errorMarker) + errorMarker.length));
  }
  return parseEngineFocusResponse(line.text).result;
}

/** Build a numeric-only, bounded request for the optional Panorama camera bridge. */
export function buildEngineFrameCommand(
  targetName: string,
  settings: EngineFrameSettings,
  requestId = "frame",
): string {
  const parsed = engineFrameRequestSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw new Error(`Invalid engine frame settings: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  const values = parsed.data;
  return [
    "mcp_frame",
    safeToken(requestId, "Frame request id"),
    safeToken(targetName, "Frame targetname"),
    values.distance,
    values.yaw,
    values.pitch,
    values.heightOffset,
    values.hideHero === true ? 1 : 0,
  ].join(" ");
}

export function parseEngineFrameResponse(line: string): { requestId: string; result: EngineFrameResult } {
  const marker = "[MCP] FRAME_OK ";
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) throw new Error(`DebugSDK did not return FRAME_OK: ${line}`);
  const payload = line.slice(markerIndex + marker.length);
  const separator = payload.indexOf(" ");
  if (separator < 1) throw new Error(`DebugSDK FRAME_OK response omitted its request id: ${line}`);
  const requestId = payload.slice(0, separator);
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.slice(separator + 1).trim());
  } catch (error) {
    throw new Error(`DebugSDK returned invalid frame JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = engineFrameResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`DebugSDK frame result had the wrong shape: ${result.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { requestId, result: result.data };
}

/** Apply deterministic camera parameters and wait only for the matching client report. */
export async function requestEngineFrame(
  vc: VConsoleClient,
  targetName: string,
  settings: EngineFrameSettings,
  timeoutMs = 5000,
): Promise<EngineFrameResult> {
  const requestId = `frame_${Date.now().toString(36)}_${(frameRequestSequence++).toString(36)}`;
  const okMarker = `[MCP] FRAME_OK ${requestId} `;
  const errorMarker = `[MCP] FRAME_ERR ${requestId} `;
  const wait = vc.waitForLine(
    (line) => line.text.includes(okMarker) || line.text.includes(errorMarker),
    timeoutMs,
  );
  vc.send(buildEngineFrameCommand(targetName, settings, requestId));
  const line = await wait;
  if (!line) throw new Error(`DebugSDK did not answer frame request ${requestId} within ${timeoutMs}ms.`);
  if (line.text.includes(errorMarker)) {
    throw new Error(line.text.slice(line.text.indexOf(errorMarker) + errorMarker.length));
  }
  return parseEngineFrameResponse(line.text).result;
}

/** Reject a clamped screen edge or a camera that settled away from the requested focus point. */
export function assessEngineFrame(
  result: EngineFrameResult,
  expectedTargetName: string,
  screenMargin = 0.05,
  maximumLookAtError = 128,
): EngineFrameAssessment {
  if (!Number.isFinite(screenMargin) || screenMargin < 0 || screenMargin >= 0.5) {
    throw new Error("Frame screen margin must be from 0 up to (but not including) 0.5.");
  }
  if (!Number.isFinite(maximumLookAtError) || maximumLookAtError < 0 || maximumLookAtError > 4096) {
    throw new Error("Maximum frame look-at error must be from 0 through 4096 world units.");
  }
  const issues: string[] = [];
  const targetMatched = result.targetName === expectedTargetName;
  if (!targetMatched) issues.push(`Camera framed ${result.targetName}; expected ${expectedTargetName}.`);
  const [u, v] = result.screenUv;
  const focusVisible = u >= screenMargin && u <= 1 - screenMargin && v >= screenMargin && v <= 1 - screenMargin;
  if (!focusVisible) {
    issues.push(`Requested focus point projected to clamped screen edge (${u.toFixed(4)}, ${v.toFixed(4)}).`);
  }
  const lookAtError = Math.hypot(
    result.lookAt[0] - result.focusPoint[0],
    result.lookAt[1] - result.focusPoint[1],
    result.lookAt[2] - result.focusPoint[2],
  );
  if (lookAtError > maximumLookAtError) {
    issues.push(`Camera look-at missed the requested focus point by ${lookAtError.toFixed(2)} world units.`);
  }
  return { passed: issues.length === 0, targetMatched, focusVisible, lookAtError, issues };
}

function forwardCycleDelta(before: number, after: number): number {
  const delta = after - before;
  return delta >= 0 ? delta : delta + 1;
}

/** Check identity/sequence on every sample and optional forward cycle movement. */
export function assessEngineAnimationSamples(
  samples: readonly EngineAnimationSample[],
  expectation: EngineAnimationExpectation,
): EngineAnimationAssessment {
  const issues: string[] = [];
  if (samples.length < 2) issues.push("At least two correlated animation samples are required.");
  const found = samples.filter((sample): sample is z.infer<typeof foundSampleSchema> => sample.found);
  if (found.length !== samples.length) {
    issues.push(`Entity ${expectation.targetName} was absent in ${samples.length - found.length}/${samples.length} samples.`);
  }
  for (const sample of found) {
    if (sample.targetName !== expectation.targetName) {
      issues.push(`Animation response named ${sample.targetName}; expected ${expectation.targetName}.`);
    }
    if (expectation.classname && sample.classname !== expectation.classname) {
      issues.push(`${expectation.targetName} is ${sample.classname}; expected ${expectation.classname}.`);
    }
    if (expectation.model && normalizedResource(sample.model) !== normalizedResource(expectation.model)) {
      issues.push(`${expectation.targetName} uses ${sample.model}; expected ${expectation.model}.`);
    }
    if (expectation.sequence && sample.sequence !== expectation.sequence) {
      issues.push(`${expectation.targetName} is playing ${sample.sequence}; expected ${expectation.sequence}.`);
    }
    if (sample.cycle < 0 || sample.cycle > 1) {
      issues.push(`${expectation.targetName} returned out-of-range cycle ${sample.cycle}.`);
    }
    if (sample.duration !== undefined && sample.duration <= 0) {
      issues.push(`${expectation.targetName} returned non-positive sequence duration ${sample.duration}.`);
    }
  }

  let cycleProgress = 0;
  for (let index = 1; index < found.length; index++) {
    cycleProgress += forwardCycleDelta(found[index - 1].cycle, found[index].cycle);
  }
  const elapsedGameTime = found.length >= 2 ? found.at(-1)!.gameTime - found[0].gameTime : 0;
  const minimum = expectation.minimumCycleProgress ?? 0.001;
  const cycleProgressed = cycleProgress >= minimum && elapsedGameTime > 0;
  if (expectation.requireCycleProgress && !cycleProgressed) {
    issues.push(
      `${expectation.targetName} cycle did not advance by ${minimum} over positive game time ` +
      `(observed ${cycleProgress.toFixed(6)} over ${elapsedGameTime.toFixed(3)}s).`,
    );
  }
  const entityPassed = issues.every((issue) => !/absent|response named| is |out-of-range|non-positive/.test(issue));
  return {
    passed: issues.length === 0,
    entityPassed,
    cycleProgressRequired: expectation.requireCycleProgress === true,
    cycleProgressed,
    cycleProgress,
    elapsedGameTime,
    issues,
  };
}

function validateRegion(region: NormalizedFrameRegion): void {
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) {
    throw new Error("Frame region values must be finite.");
  }
  if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
      region.x + region.width > 1 || region.y + region.height > 1) {
    throw new Error("Frame region must be a positive normalized rectangle contained within 0..1.");
  }
}

function warmPixel(r: number, g: number, b: number): boolean {
  return r >= 56 && r >= g * 1.12 && r >= b * 1.18;
}

/** Compare checked PNG frames inside one bounded ROI; no resampling or alignment guesses. */
export function compareAnimationFrames(
  beforePng: Buffer,
  afterPng: Buffer,
  normalizedRegion: NormalizedFrameRegion,
  threshold = 12,
): FrameMotionReport {
  validateRegion(normalizedRegion);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 255) {
    throw new Error("Frame difference threshold must be an integer from 1 through 255.");
  }
  const before = decodePng(beforePng);
  const after = decodePng(afterPng);
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `Animation frames have different dimensions: ${before.width}x${before.height} and ${after.width}x${after.height}.`,
    );
  }
  const x0 = Math.floor(before.width * normalizedRegion.x);
  const y0 = Math.floor(before.height * normalizedRegion.y);
  const x1 = Math.max(x0 + 1, Math.ceil(before.width * (normalizedRegion.x + normalizedRegion.width)));
  const y1 = Math.max(y0 + 1, Math.ceil(before.height * (normalizedRegion.y + normalizedRegion.height)));
  let sampledPixels = 0;
  let changedPixels = 0;
  let absoluteDelta = 0;
  let changedDelta = 0;
  let warmEligiblePixels = 0;
  let warmChangedPixels = 0;
  let minX = x1;
  let minY = y1;
  let maxX = -1;
  let maxY = -1;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * before.width + x) * 4;
      const dr = Math.abs(before.rgba[offset] - after.rgba[offset]);
      const dg = Math.abs(before.rgba[offset + 1] - after.rgba[offset + 1]);
      const db = Math.abs(before.rgba[offset + 2] - after.rgba[offset + 2]);
      const meanDelta = (dr + dg + db) / 3;
      const changed = Math.max(dr, dg, db) >= threshold;
      const warm = warmPixel(before.rgba[offset], before.rgba[offset + 1], before.rgba[offset + 2]) ||
        warmPixel(after.rgba[offset], after.rgba[offset + 1], after.rgba[offset + 2]);
      sampledPixels++;
      absoluteDelta += meanDelta;
      if (warm) warmEligiblePixels++;
      if (!changed) continue;
      changedPixels++;
      changedDelta += meanDelta;
      if (warm) warmChangedPixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    width: before.width,
    height: before.height,
    region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    threshold,
    sampledPixels,
    changedPixels,
    changedFraction: changedPixels / sampledPixels,
    meanAbsoluteDelta: absoluteDelta / sampledPixels,
    meanChangedDelta: changedPixels ? changedDelta / changedPixels : 0,
    warmEligiblePixels,
    warmChangedPixels,
    warmChangedFraction: warmEligiblePixels ? warmChangedPixels / warmEligiblePixels : 0,
    ...(changedPixels ? { changedBounds: { minX, minY, maxX, maxY } } : {}),
  };
}

/** Fail closed on no motion, no banner-colour evidence, or a likely whole-camera shift. */
export function assessBannerFrameMotion(
  report: FrameMotionReport,
  thresholds: BannerFrameMotionThresholds = {},
): FrameMotionAssessment {
  const issues: string[] = [];
  const minimumWarmEligiblePixels = thresholds.minimumWarmEligiblePixels ?? 64;
  const minimumWarmChangedPixels = thresholds.minimumWarmChangedPixels ?? 32;
  const minimumWarmChangedFraction = thresholds.minimumWarmChangedFraction ?? 0.002;
  if (report.sampledPixels < 4096) issues.push("The renderer ROI is too small for a stable motion check.");
  if (report.changedPixels < 128 || report.changedFraction < 0.0002) {
    issues.push(`Too little renderer motion: ${report.changedPixels} changed pixels (${(report.changedFraction * 100).toFixed(3)}%).`);
  }
  if (report.changedFraction > 0.35) {
    issues.push(`Too much of the ROI changed (${(report.changedFraction * 100).toFixed(1)}%); the camera or whole scene may have moved.`);
  }
  if (report.warmEligiblePixels < minimumWarmEligiblePixels) {
    issues.push(
      `The ROI contains only ${report.warmEligiblePixels} warm banner-colour pixels; ` +
      `${minimumWarmEligiblePixels} are required.`,
    );
  } else if (report.warmChangedPixels < minimumWarmChangedPixels ||
      report.warmChangedFraction < minimumWarmChangedFraction) {
    issues.push(
      `Warm banner-colour motion is too small: ${report.warmChangedPixels}/${report.warmEligiblePixels} pixels ` +
      `(${(report.warmChangedFraction * 100).toFixed(3)}%).`,
    );
  }
  return { passed: issues.length === 0, issues, report };
}
