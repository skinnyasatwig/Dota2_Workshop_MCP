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

export interface ModelPhysicsBounds {
  min: Vector3;
  max: Vector3;
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
  version: 1;
  entries: Record<string, CachedInspection>;
}

const cacheFile = join(vrfDir(), "model-physics-cache-v1.json");
let cache: PhysicsCacheFile | undefined;
let cacheWrite = Promise.resolve();
const pending = new Map<string, Promise<ModelPhysicsInspection>>();

function vector(text: string): Vector3 | undefined {
  const values = text.trim().split(/[\s,]+/).map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return undefined;
  return values as Vector3;
}

/** Parse only bounds nested in a decompiled PHYS block. */
export function parseVrfPhysicsBounds(text: string): ModelPhysicsBounds[] {
  const marker = text.indexOf('--- Data for block "PHYS" ---');
  if (marker < 0) return [];
  const block = text.slice(marker);
  const bounds: ModelPhysicsBounds[] = [];
  const seen = new Set<string>();
  const pattern = /m_vMinBounds\s*=\s*\[\s*([^\]]+)\][\s\S]*?m_vMaxBounds\s*=\s*\[\s*([^\]]+)\]/g;
  for (const match of block.matchAll(pattern)) {
    const min = vector(match[1]);
    const max = vector(match[2]);
    if (!min || !max || min.some((value, index) => value > max[index])) continue;
    const key = `${min.join(",")}|${max.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bounds.push({ min, max });
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
    cache = parsed.version === 1 && parsed.entries ? parsed : { version: 1, entries: {} };
  } catch {
    cache = { version: 1, entries: {} };
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
    const stored: CachedInspection = bounds.length
      ? {
          model,
          status: "physical-bounds",
          bounds,
          source: "vrf-phys",
          detail:
            `${bounds.length} conservative physical hull bound(s) recovered from the ` +
            `${options.sourceLabel} model PHYS block.`,
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
): Promise<ModelPhysicsInspection> {
  const model = normalizeCompiledModelPath(requestedModel);
  if (!model) {
    return errorInspection(requestedModel, "Model path is not a safe models/*.vmdl resource.");
  }
  const key = `vpk|${await fingerprint(vpk)}|${model.toLowerCase()}`;
  return inspectVrfResource(key, model, ["-i", vpk, "-f", model, "-b", "PHYS"], {
    missingOutputNeedle: model,
    missingDetail: "The model was not found in the base Dota VPK.",
    sourceLabel: "base-VPK",
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
