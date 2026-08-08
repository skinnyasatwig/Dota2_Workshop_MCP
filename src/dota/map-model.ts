import { isAbsolute, join, resolve, sep } from "node:path";
import { AddonProject } from "./project.js";
import { DotaPaths } from "./paths.js";
import { PackedResourceIndex } from "./map-material.js";
import { Vpk } from "./vpk.js";
import { pathExists } from "../util/fsx.js";

export interface MapModelFinding {
  severity: "error" | "warn";
  code:
    | "map-model-path-invalid"
    | "map-model-missing"
    | "map-model-compiled-missing"
    | "map-model-package-unreadable";
  model?: string;
  detail: string;
}

export interface MapModelResolution {
  model: string;
  references: number;
  sourceLocations: string[];
  compiledLocations: string[];
  packages: string[];
  state: "resolved" | "source-only" | "missing" | "invalid";
}

export interface MapModelReport {
  referenceCount: number;
  uniqueModelCount: number;
  resolvedCount: number;
  sourceOnlyCount: number;
  missingCount: number;
  invalidCount: number;
  compiledReady: boolean;
  safeToWrite: boolean;
  models: MapModelResolution[];
  findings: MapModelFinding[];
}

export interface InspectMapModelsOptions {
  mapText: string;
  sourceRoots?: readonly string[];
  compiledRoots?: readonly string[];
  packedResources?: readonly PackedResourceIndex[];
  packageFindings?: readonly MapModelFinding[];
  requireCompiledAssets?: boolean;
}

function decodeQuoted(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/** Extract every Source 2 model resource path serialized anywhere in a VMAP. */
export function extractMapModelReferences(mapText: string): string[] {
  const references: string[] = [];
  for (const match of mapText.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    const value = decodeQuoted(match[1]).replace(/\\/g, "/");
    if (/\.vmdl(?:_c)?$/i.test(value)) references.push(value);
  }
  return references;
}

function normalizedModelPath(model: string): string | undefined {
  const normalized = model.replace(/\\/g, "/");
  if (
    isAbsolute(model) ||
    !/^[A-Za-z0-9_./-]+\.vmdl(?:_c)?$/i.test(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))
  ) return undefined;
  return normalized;
}

function pathInside(root: string, resource: string): string | undefined {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, ...resource.split("/"));
  if (candidate !== rootPath && !candidate.startsWith(rootPath + sep)) return undefined;
  return candidate;
}

async function existingLocations(roots: readonly string[], resource: string): Promise<string[]> {
  const candidates = roots
    .map((root) => pathInside(root, resource))
    .filter((path): path is string => Boolean(path));
  const exists = await Promise.all(candidates.map(pathExists));
  return candidates.filter((_path, index) => exists[index]);
}

/** Resolve all VMAP model references against loose content/game roots and packed resources. */
export async function inspectMapModels(options: InspectMapModelsOptions): Promise<MapModelReport> {
  const rawReferences = extractMapModelReferences(options.mapText);
  const counts = new Map<string, { model: string; count: number }>();
  for (const model of rawReferences) {
    const key = model.toLowerCase();
    const current = counts.get(key);
    if (current) current.count++;
    else counts.set(key, { model, count: 1 });
  }

  const findings: MapModelFinding[] = [...(options.packageFindings ?? [])];
  const models: MapModelResolution[] = [];
  for (const { model, count } of [...counts.values()].sort((left, right) =>
    left.model.localeCompare(right.model, undefined, { sensitivity: "base" }))) {
    const normalized = normalizedModelPath(model);
    if (!normalized) {
      models.push({
        model,
        references: count,
        sourceLocations: [],
        compiledLocations: [],
        packages: [],
        state: "invalid",
      });
      findings.push({
        severity: "error",
        code: "map-model-path-invalid",
        model,
        detail: `Unsafe or unsupported VMAP model path: ${model}.`,
      });
      continue;
    }

    const sourceResource = normalized.replace(/_c$/i, "");
    const compiledResource = sourceResource + "_c";
    const [sourceLocations, compiledLocations] = await Promise.all([
      existingLocations(options.sourceRoots ?? [], sourceResource),
      existingLocations(options.compiledRoots ?? [], compiledResource),
    ]);
    const packages = (options.packedResources ?? [])
      .filter((packed) => packed.entries.has(compiledResource.toLowerCase()))
      .map((packed) => packed.label);
    const compiled = compiledLocations.length > 0 || packages.length > 0;
    const source = sourceLocations.length > 0;
    const state = compiled ? "resolved" : source ? "source-only" : "missing";
    models.push({
      model: sourceResource,
      references: count,
      sourceLocations,
      compiledLocations,
      packages,
      state,
    });
    if (state === "missing") {
      findings.push({
        severity: "error",
        code: "map-model-missing",
        model: sourceResource,
        detail: `VMAP model is absent from addon/base content, compiled game assets, and searched VPKs: ${sourceResource}.`,
      });
    } else if (state === "source-only") {
      findings.push({
        severity: options.requireCompiledAssets ? "error" : "warn",
        code: "map-model-compiled-missing",
        model: sourceResource,
        detail: `VMAP model has source content but no compiled asset yet: ${sourceResource}.`,
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const sourceOnlyCount = models.filter((model) => model.state === "source-only").length;
  return {
    referenceCount: rawReferences.length,
    uniqueModelCount: models.length,
    resolvedCount: models.filter((model) => model.state === "resolved").length,
    sourceOnlyCount,
    missingCount: models.filter((model) => model.state === "missing").length,
    invalidCount: models.filter((model) => model.state === "invalid").length,
    compiledReady: sourceOnlyCount === 0 && errorCount === 0,
    safeToWrite: errorCount === 0,
    models,
    findings,
  };
}

async function packedIndexes(paths: readonly { label: string; path: string }[]): Promise<{
  indexes: PackedResourceIndex[];
  findings: MapModelFinding[];
}> {
  const indexes: PackedResourceIndex[] = [];
  const findings: MapModelFinding[] = [];
  const seen = new Set<string>();
  for (const candidate of paths) {
    const key = resolve(candidate.path).toLowerCase();
    if (seen.has(key) || !(await pathExists(candidate.path))) continue;
    seen.add(key);
    try {
      const vpk = await Vpk.open(candidate.path);
      indexes.push({ label: candidate.label, entries: vpk.entries });
    } catch (error) {
      findings.push({
        severity: "warn",
        code: "map-model-package-unreadable",
        detail: `Could not inspect ${candidate.label} (${candidate.path}): ${error instanceof Error ? error.message : String(error)}.`,
      });
    }
  }
  return { indexes, findings };
}

/** Resolve a map's models using the current addon plus Dota's loose and packed resources. */
export async function inspectProjectMapModels(
  mapText: string,
  dota: DotaPaths,
  project: AddonProject,
  requireCompiledAssets = false,
): Promise<MapModelReport> {
  const coreGame = join(dota.root, "game", "core");
  const packed = await packedIndexes([
    { label: "addon pak01", path: join(project.gameDir, "pak01_dir.vpk") },
    { label: "Dota pak01", path: dota.pak01DirVpk },
    { label: "core pak01", path: join(coreGame, "pak01_dir.vpk") },
  ]);
  return inspectMapModels({
    mapText,
    sourceRoots: [
      project.contentDir,
      join(dota.root, "content", "dota"),
      join(dota.root, "content", "core"),
    ],
    compiledRoots: [project.gameDir, dota.dotaGameDir, coreGame],
    packedResources: packed.indexes,
    packageFindings: packed.findings,
    requireCompiledAssets,
  });
}
