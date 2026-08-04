// Recover conservative physical bounds from compiled Source 2 models without launching Dota.
// ValveResourceFormat (VRF) exposes the model's PHYS block as text. We intentionally use only
// bounds found inside that block: render and hitbox bounds are not proof of world collision.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { replaceFileFromPath } from "../util/file-transaction.js";
import { run } from "./process.js";
import { ensureVrf, vrfDir } from "./vrf.js";

export type Vector3 = [number, number, number];
export type ModelPhysicsGeometry =
  | "convex-hull"
  | "mesh-vertex-hull"
  | "sphere-bounds"
  | "capsule-bounds"
  | "bounds";

export interface ModelPhysicsBounds {
  min: Vector3;
  max: Vector3;
  /** Model-space vertices for a convex hull or a conservative convex envelope of a PHYS mesh. */
  vertices?: Vector3[];
  geometry?: ModelPhysicsGeometry;
}

export interface ModelPhysicsInspection {
  model: string;
  status: "physical-bounds" | "no-physics" | "error";
  bounds: ModelPhysicsBounds[];
  source: "vrf-phys";
  fromCache: boolean;
  detail: string;
}

interface CachedInspection {
  model: string;
  status: "physical-bounds" | "no-physics";
  bounds: ModelPhysicsBounds[];
  source: "vrf-phys";
  detail: string;
}

interface PhysicsCacheFile {
  version: 3;
  entries: Record<string, CachedInspection>;
}

const cacheFile = join(vrfDir(), "model-physics-cache-v3.json");
let cache: PhysicsCacheFile | undefined;
let cacheWrite = Promise.resolve();
const pending = new Map<string, Promise<ModelPhysicsInspection>>();

function vector(text: string): Vector3 | undefined {
  const values = text.trim().split(/[\s,]+/).map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return undefined;
  return values as Vector3;
}

function assignedObjectBlocks(text: string, property: string): string[] {
  const blocks: string[] = [];
  const assignment = new RegExp(`\\b${property}\\s*=\\s*\\{`, "g");
  for (const match of text.matchAll(assignment)) {
    const open = text.indexOf("{", match.index!);
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = open; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) {
        blocks.push(text.slice(open, index + 1));
        break;
      }
    }
  }
  return blocks;
}

function parseNamedBounds(
  block: string,
  minProperty = "m_vMinBounds",
  maxProperty = "m_vMaxBounds",
): ModelPhysicsBounds | undefined {
  const match = new RegExp(
    `${minProperty}\\s*=\\s*\\[\\s*([^\\]]+)\\][\\s\\S]*?` +
    `${maxProperty}\\s*=\\s*\\[\\s*([^\\]]+)\\]`,
  ).exec(block);
  const min = match && vector(match[1]);
  const max = match && vector(match[2]);
  if (!min || !max || min.some((value, index) => value > max[index])) return undefined;
  return { min, max };
}

function assignedArrayBlock(text: string, property: string): string | undefined {
  const match = new RegExp(`\\b${property}\\s*=\\s*#?\\[`).exec(text);
  if (!match) return undefined;
  const open = text.indexOf("[", match.index);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = open; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "[") depth++;
    else if (character === "]" && --depth === 0) return text.slice(open, index + 1);
  }
  return undefined;
}

function parseFloat3Blob(
  block: string,
  property: string,
  maxVertices: number,
): Vector3[] | undefined {
  const match = new RegExp(`\\b${property}\\s*=\\s*#\\[([\\s\\S]*?)\\]`).exec(block);
  if (!match) return undefined;
  const bytes = match[1].match(/\b[0-9A-Fa-f]{2}\b/g) ?? [];
  if (bytes.length < 36 || bytes.length % 12 !== 0 || bytes.length / 12 > maxVertices) return undefined;
  const binary = Buffer.from(bytes.join(""), "hex");
  const vertices: Vector3[] = [];
  for (let offset = 0; offset < binary.length; offset += 12) {
    const vertex: Vector3 = [
      binary.readFloatLE(offset),
      binary.readFloatLE(offset + 4),
      binary.readFloatLE(offset + 8),
    ];
    if (vertex.some((coordinate) => !Number.isFinite(coordinate))) return undefined;
    vertices.push(vertex);
  }
  return vertices;
}

const NUMBER_PATTERN = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";

function parseFloat3TextArray(
  block: string,
  property: string,
  maxVertices: number,
  minVertices = 3,
): Vector3[] | undefined {
  const array = assignedArrayBlock(block, property);
  if (!array || array.startsWith("#[")) return undefined;
  const pattern = new RegExp(
    `\\[\\s*(${NUMBER_PATTERN})\\s*,\\s*(${NUMBER_PATTERN})\\s*,\\s*(${NUMBER_PATTERN})\\s*,?\\s*\\]`,
    "g",
  );
  const vertices = [...array.matchAll(pattern)].map((match) =>
    [Number(match[1]), Number(match[2]), Number(match[3])] as Vector3);
  if (vertices.length < minVertices || vertices.length > maxVertices ||
      vertices.some((vertex) => vertex.some((coordinate) => !Number.isFinite(coordinate)))) {
    return undefined;
  }
  return vertices;
}

function parseShapeVertices(
  block: string,
  maxVertices: number,
): Vector3[] | undefined {
  // Newer resources keep byte-sized vertex indices in m_Vertices and float positions in
  // m_VertexPositions. Older resources store the float positions directly in m_Vertices.
  return parseFloat3Blob(block, "m_VertexPositions", maxVertices) ??
    parseFloat3TextArray(block, "m_VertexPositions", maxVertices) ??
    parseFloat3Blob(block, "m_Vertices", maxVertices) ??
    parseFloat3TextArray(block, "m_Vertices", maxVertices);
}

function verticesFitBounds(vertices: readonly Vector3[], bounds: ModelPhysicsBounds): boolean {
  return vertices.every((vertex) => vertex.every((coordinate, axis) => {
    const tolerance = Math.max(1e-3, Math.abs(bounds.max[axis] - bounds.min[axis]) * 1e-4);
    return coordinate >= bounds.min[axis] - tolerance && coordinate <= bounds.max[axis] + tolerance;
  }));
}

type PhysicsPose = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

function parseBindPoses(block: string): PhysicsPose[] {
  const array = assignedArrayBlock(block, "m_bindPose");
  if (!array) return [];
  const poses: PhysicsPose[] = [];
  for (const match of array.matchAll(/\[([^\[\]]+)\]/g)) {
    const values = match[1].match(new RegExp(NUMBER_PATTERN, "g"))?.map(Number) ?? [];
    if (values.length !== 12 || values.some((value) => !Number.isFinite(value))) continue;
    poses.push(values as PhysicsPose);
  }
  return poses;
}

function transformPose(point: readonly [number, number, number], pose?: PhysicsPose): Vector3 {
  if (!pose) return [...point];
  return [
    point[0] * pose[0] + point[1] * pose[1] + point[2] * pose[2] + pose[3],
    point[0] * pose[4] + point[1] * pose[5] + point[2] * pose[6] + pose[7],
    point[0] * pose[8] + point[1] * pose[9] + point[2] * pose[10] + pose[11],
  ];
}

function boundsFromPoints(points: readonly Vector3[]): ModelPhysicsBounds | undefined {
  if (!points.length || points.some((point) => point.some((coordinate) => !Number.isFinite(coordinate)))) {
    return undefined;
  }
  const min: Vector3 = [...points[0]];
  const max: Vector3 = [...points[0]];
  for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
    const point = points[pointIndex];
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}

function boundCorners(bounds: ModelPhysicsBounds): Vector3[] {
  const points: Vector3[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) points.push([x, y, z]);
    }
  }
  return points;
}

function posedShape(
  localBounds: ModelPhysicsBounds,
  pose: PhysicsPose | undefined,
  geometry: ModelPhysicsGeometry,
  localVertices?: readonly Vector3[],
): ModelPhysicsBounds | undefined {
  const vertices = localVertices?.map((vertex) => transformPose(vertex, pose));
  const posedBounds = boundsFromPoints(vertices?.length
    ? vertices
    : boundCorners(localBounds).map((point) => transformPose(point, pose)));
  return posedBounds && {
    ...posedBounds,
    ...(vertices?.length ? { vertices } : {}),
    geometry,
  };
}

function vectorProperty(block: string, property: string): Vector3 | undefined {
  const match = new RegExp(`\\b${property}\\s*=\\s*\\[\\s*([^\\]]+)\\]`).exec(block);
  return match ? vector(match[1]) : undefined;
}

function numberProperty(block: string, property: string): number | undefined {
  const match = new RegExp(`\\b${property}\\s*=\\s*(${NUMBER_PATTERN})`).exec(block);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function addUniqueShape(
  output: ModelPhysicsBounds[],
  seen: Set<string>,
  shape: ModelPhysicsBounds | undefined,
): void {
  if (!shape) return;
  const key = `${shape.geometry ?? "bounds"}|${shape.min.join(",")}|${shape.max.join(",")}|` +
    `${JSON.stringify(shape.vertices ?? [])}`;
  if (seen.has(key)) return;
  seen.add(key);
  output.push(shape);
}

/** Parse model-space PHYS shapes, preserving exact hull vertices and conservative fallbacks. */
export function parseVrfPhysicsBounds(text: string): ModelPhysicsBounds[] {
  const marker = text.indexOf('--- Data for block "PHYS" ---');
  if (marker < 0) return [];
  const block = text.slice(marker);
  const bounds: ModelPhysicsBounds[] = [];
  const seen = new Set<string>();
  const poses = parseBindPoses(block);
  const hasBindPoseData = /m_bindPose\s*=\s*\[(?!\s*\])/.test(block);
  const partShapes = assignedObjectBlocks(block, "m_rnShape");
  const shapeSources = partShapes.length ? partShapes : [block];

  for (const [partIndex, shapeSource] of shapeSources.entries()) {
    const pose = poses[partIndex];
    if (hasBindPoseData && !pose) continue;

    for (const hull of assignedObjectBlocks(shapeSource, "m_Hull")) {
      const localBounds = parseNamedBounds(hull);
      if (!localBounds) continue;
      const candidateVertices = parseShapeVertices(hull, 255);
      const vertices = candidateVertices && verticesFitBounds(candidateVertices, localBounds)
        ? candidateVertices
        : undefined;
      addUniqueShape(
        bounds,
        seen,
        posedShape(localBounds, pose, vertices ? "convex-hull" : "bounds", vertices),
      );
    }

    for (const mesh of assignedObjectBlocks(shapeSource, "m_Mesh")) {
      const localBounds = parseNamedBounds(mesh, "m_vMin", "m_vMax");
      if (!localBounds) continue;
      const candidateVertices = parseShapeVertices(mesh, 16_384);
      const vertices = candidateVertices && verticesFitBounds(candidateVertices, localBounds)
        ? candidateVertices
        : undefined;
      addUniqueShape(
        bounds,
        seen,
        posedShape(localBounds, pose, vertices ? "mesh-vertex-hull" : "bounds", vertices),
      );
    }

    for (const sphere of assignedObjectBlocks(shapeSource, "m_Sphere")) {
      const center = vectorProperty(sphere, "m_vCenter");
      const radius = numberProperty(sphere, "m_flRadius");
      if (!center || radius === undefined || radius <= 0) continue;
      const localBounds: ModelPhysicsBounds = {
        min: center.map((coordinate) => coordinate - radius) as Vector3,
        max: center.map((coordinate) => coordinate + radius) as Vector3,
      };
      addUniqueShape(bounds, seen, posedShape(localBounds, pose, "sphere-bounds"));
    }

    for (const capsule of assignedObjectBlocks(shapeSource, "m_Capsule")) {
      const centers = parseFloat3TextArray(capsule, "m_vCenter", 2, 2);
      const radius = numberProperty(capsule, "m_flRadius");
      if (!centers || centers.length !== 2 || radius === undefined || radius <= 0) continue;
      const localBounds: ModelPhysicsBounds = {
        min: [
          Math.min(centers[0][0], centers[1][0]) - radius,
          Math.min(centers[0][1], centers[1][1]) - radius,
          Math.min(centers[0][2], centers[1][2]) - radius,
        ],
        max: [
          Math.max(centers[0][0], centers[1][0]) + radius,
          Math.max(centers[0][1], centers[1][1]) + radius,
          Math.max(centers[0][2], centers[1][2]) + radius,
        ],
      };
      addUniqueShape(bounds, seen, posedShape(localBounds, pose, "capsule-bounds"));
    }
  }

  // Older/unknown layouts retain the established conservative-bounds fallback when no structured
  // shape was recoverable and no unapplied bind pose could make those local bounds misleading.
  if (bounds.length || hasBindPoseData) return bounds;
  const pattern = /m_vMinBounds\s*=\s*\[\s*([^\]]+)\][\s\S]*?m_vMaxBounds\s*=\s*\[\s*([^\]]+)\]/g;
  for (const match of block.matchAll(pattern)) {
    const min = vector(match[1]);
    const max = vector(match[2]);
    if (!min || !max || min.some((value, index) => value > max[index])) continue;
    addUniqueShape(bounds, seen, { min, max, geometry: "bounds" });
  }
  return bounds;
}

export function normalizeCompiledModelPath(model: string): string | undefined {
  const normalized = model.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/^models\/.+\.vmdl(?:_c)?$/i.test(normalized)) return undefined;
  if (normalized.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))) {
    return undefined;
  }
  return /_c$/i.test(normalized) ? normalized : `${normalized}_c`;
}

async function loadCache(): Promise<PhysicsCacheFile> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(cacheFile, "utf8")) as PhysicsCacheFile;
    cache = parsed.version === 3 && parsed.entries ? parsed : { version: 3, entries: {} };
  } catch {
    cache = { version: 3, entries: {} };
  }
  return cache;
}

function saveCache(): Promise<void> {
  cacheWrite = cacheWrite.catch(() => {}).then(async () => {
    if (!cache) return;
    await mkdir(vrfDir(), { recursive: true });
    const temporary = `${cacheFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(cache, null, 2) + "\n", "utf8");
      await replaceFileFromPath(temporary, cacheFile);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  });
  return cacheWrite;
}

async function fingerprint(path: string): Promise<string> {
  const metadata = await stat(path);
  return `${path.toLowerCase()}|${metadata.size}|${Math.floor(metadata.mtimeMs)}`;
}

function errorInspection(model: string, detail: string): ModelPhysicsInspection {
  return {
    model,
    status: "error",
    bounds: [],
    source: "vrf-phys",
    fromCache: false,
    detail,
  };
}

async function inspectVrfResource(
  key: string,
  model: string,
  args: string[],
  options: { missingOutputNeedle?: string; missingDetail?: string; sourceLabel: string },
): Promise<ModelPhysicsInspection> {
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async (): Promise<ModelPhysicsInspection> => {
    const loaded = await loadCache();
    const cached = loaded.entries[key];
    if (cached) return { ...cached, fromCache: true };

    const exe = await ensureVrf();
    const result = await run(exe, args, { timeoutMs: 120_000, maxOutputChars: 8_000_000 });
    if (result.timedOut || result.code !== 0) {
      return errorInspection(
        model,
        result.timedOut
          ? "VRF physics inspection timed out."
          : `VRF physics inspection failed: ${(result.stderr || result.stdout).slice(-300)}`,
      );
    }
    if (result.stdout.includes("...(truncated)...")) {
      return errorInspection(model, "VRF PHYS output exceeded the safe parser limit; bounds were not guessed.");
    }
    if (options.missingOutputNeedle &&
        !result.stdout.toLowerCase().includes(options.missingOutputNeedle.toLowerCase())) {
      return errorInspection(model, options.missingDetail ?? "The model resource was not found.");
    }

    const bounds = parseVrfPhysicsBounds(result.stdout);
    if (!bounds.length && /\bm_(?:Hull|Mesh|Sphere|Capsule)\s*=/.test(result.stdout)) {
      return errorInspection(
        model,
        "The model PHYS block contains shapes, but their geometry or bind pose could not be decoded safely.",
      );
    }
    const exactHullCount = bounds.filter((entry) => entry.geometry === "convex-hull").length;
    const meshHullCount = bounds.filter((entry) => entry.geometry === "mesh-vertex-hull").length;
    const stored: CachedInspection = bounds.length
      ? {
          model,
          status: "physical-bounds",
          bounds,
          source: "vrf-phys",
          detail:
            `${bounds.length} conservative physical hull bound(s) recovered from the ` +
            `${options.sourceLabel} model PHYS block` +
            `${exactHullCount ? `; ${exactHullCount} include exact convex-hull vertices` : ""}` +
            `${meshHullCount ? `; ${meshHullCount} include mesh-vertex envelopes` : ""}.`,
        }
      : {
          model,
          status: "no-physics",
          bounds: [],
          source: "vrf-phys",
          detail: `The ${options.sourceLabel} model has no non-empty physical hull bounds in its PHYS block.`,
        };
    loaded.entries[key] = stored;
    // Cache persistence is an optimization, not a prerequisite for a truthful result. A read-only
    // home directory must not turn successful PHYS extraction into a validation failure.
    await saveCache().catch(() => {});
    return { ...stored, fromCache: false };
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

/**
 * Inspect one base-game model. Successful positive and negative results are cached by VPK
 * fingerprint; transient tool failures are not cached.
 */
export async function inspectVpkModelPhysics(
  vpk: string,
  requestedModel: string,
  sourceLabel = "base-VPK",
): Promise<ModelPhysicsInspection> {
  const model = normalizeCompiledModelPath(requestedModel);
  if (!model) {
    return errorInspection(requestedModel, "Model path is not a safe models/*.vmdl resource.");
  }
  const key = `vpk|${await fingerprint(vpk)}|${model.toLowerCase()}`;
  return inspectVrfResource(key, model, ["-i", vpk, "-f", model, "-b", "PHYS"], {
    missingOutputNeedle: model,
    missingDetail: `The model was not found in the ${sourceLabel}.`,
    sourceLabel,
  });
}

/** Inspect one loose compiled addon model (.vmdl_c) with the same fingerprinted cache. */
export async function inspectCompiledModelPhysics(
  compiledModelFile: string,
  requestedModel?: string,
): Promise<ModelPhysicsInspection> {
  const model = requestedModel ? normalizeCompiledModelPath(requestedModel) : undefined;
  if (!/\.vmdl_c$/i.test(compiledModelFile) || (requestedModel && !model)) {
    return errorInspection(requestedModel ?? compiledModelFile, "Compiled model input must be a safe .vmdl_c resource.");
  }
  let key: string;
  try {
    key = `file|${await fingerprint(compiledModelFile)}`;
  } catch (cause) {
    return errorInspection(
      model ?? compiledModelFile,
      `Compiled addon model is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return inspectVrfResource(
    key,
    model ?? compiledModelFile,
    ["-i", compiledModelFile, "-b", "PHYS"],
    { sourceLabel: "compiled-addon" },
  );
}
