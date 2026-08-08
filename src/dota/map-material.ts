import { isAbsolute, join, resolve, sep } from "node:path";
import { AddonProject } from "./project.js";
import { DotaPaths } from "./paths.js";
import { Vpk } from "./vpk.js";
import { pathExists } from "../util/fsx.js";

export interface PackedResourceIndex {
  label: string;
  entries: { has(path: string): boolean };
}

export interface MapMaterialFinding {
  severity: "error" | "warn";
  code:
    | "map-material-path-invalid"
    | "map-material-missing"
    | "map-material-compiled-missing"
    | "map-material-package-unreadable";
  material?: string;
  detail: string;
}

export interface MapMaterialResolution {
  material: string;
  references: number;
  sourceLocations: string[];
  compiledLocations: string[];
  packages: string[];
  state: "resolved" | "source-only" | "missing" | "invalid";
}

export interface MapMaterialReport {
  referenceCount: number;
  uniqueMaterialCount: number;
  resolvedCount: number;
  sourceOnlyCount: number;
  missingCount: number;
  invalidCount: number;
  compiledReady: boolean;
  safeToWrite: boolean;
  materials: MapMaterialResolution[];
  findings: MapMaterialFinding[];
}

export interface InspectMapMaterialsOptions {
  mapText: string;
  sourceRoots?: readonly string[];
  compiledRoots?: readonly string[];
  packedResources?: readonly PackedResourceIndex[];
  packageFindings?: readonly MapMaterialFinding[];
  requireCompiledAssets?: boolean;
}

function decodeQuoted(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/** Extract every Source 2 material resource path serialized anywhere in a VMAP. */
export function extractMapMaterialReferences(mapText: string): string[] {
  const references: string[] = [];
  for (const match of mapText.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
    const value = decodeQuoted(match[1]).replace(/\\/g, "/");
    if (/^materials\/.*\.vmat(?:_c)?$/i.test(value)) references.push(value);
  }
  return references;
}

function normalizedMaterialPath(material: string): string | undefined {
  const normalized = material.replace(/\\/g, "/");
  if (
    isAbsolute(material) ||
    !/^materials\/[A-Za-z0-9_./-]+\.vmat(?:_c)?$/i.test(normalized) ||
    normalized.split("/").includes("..")
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

/** Resolve all VMAP material references against loose content/game roots and packed resources. */
export async function inspectMapMaterials(options: InspectMapMaterialsOptions): Promise<MapMaterialReport> {
  const rawReferences = extractMapMaterialReferences(options.mapText);
  const counts = new Map<string, { material: string; count: number }>();
  for (const material of rawReferences) {
    const key = material.toLowerCase();
    const current = counts.get(key);
    if (current) current.count++;
    else counts.set(key, { material, count: 1 });
  }

  const findings: MapMaterialFinding[] = [...(options.packageFindings ?? [])];
  const materials: MapMaterialResolution[] = [];
  for (const { material, count } of [...counts.values()].sort((a, b) =>
    a.material.localeCompare(b.material, undefined, { sensitivity: "base" }))) {
    const normalized = normalizedMaterialPath(material);
    if (!normalized) {
      materials.push({
        material,
        references: count,
        sourceLocations: [],
        compiledLocations: [],
        packages: [],
        state: "invalid",
      });
      findings.push({
        severity: "error",
        code: "map-material-path-invalid",
        material,
        detail: `Unsafe or unsupported VMAP material path: ${material}.`,
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
    materials.push({
      material: sourceResource,
      references: count,
      sourceLocations,
      compiledLocations,
      packages,
      state,
    });
    if (state === "missing") {
      findings.push({
        severity: "error",
        code: "map-material-missing",
        material: sourceResource,
        detail: `VMAP material is absent from addon/base content, compiled game assets, and searched VPKs: ${sourceResource}.`,
      });
    } else if (state === "source-only") {
      findings.push({
        severity: options.requireCompiledAssets ? "error" : "warn",
        code: "map-material-compiled-missing",
        material: sourceResource,
        detail: `VMAP material has source content but no compiled asset yet: ${sourceResource}.`,
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const sourceOnlyCount = materials.filter((material) => material.state === "source-only").length;
  return {
    referenceCount: rawReferences.length,
    uniqueMaterialCount: materials.length,
    resolvedCount: materials.filter((material) => material.state === "resolved").length,
    sourceOnlyCount,
    missingCount: materials.filter((material) => material.state === "missing").length,
    invalidCount: materials.filter((material) => material.state === "invalid").length,
    compiledReady: sourceOnlyCount === 0 && errorCount === 0,
    safeToWrite: errorCount === 0,
    materials,
    findings,
  };
}

async function packedIndexes(paths: readonly { label: string; path: string }[]): Promise<{
  indexes: PackedResourceIndex[];
  findings: MapMaterialFinding[];
}> {
  const indexes: PackedResourceIndex[] = [];
  const findings: MapMaterialFinding[] = [];
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
        code: "map-material-package-unreadable",
        detail: `Could not inspect ${candidate.label} (${candidate.path}): ${error instanceof Error ? error.message : String(error)}.`,
      });
    }
  }
  return { indexes, findings };
}

/** Resolve a map's materials using the current addon plus Dota's loose and packed resources. */
export async function inspectProjectMapMaterials(
  mapText: string,
  dota: DotaPaths,
  project: AddonProject,
  requireCompiledAssets = false,
): Promise<MapMaterialReport> {
  const coreGame = join(dota.root, "game", "core");
  const packed = await packedIndexes([
    { label: "addon pak01", path: join(project.gameDir, "pak01_dir.vpk") },
    { label: "Dota pak01", path: dota.pak01DirVpk },
    { label: "core pak01", path: join(coreGame, "pak01_dir.vpk") },
  ]);
  return inspectMapMaterials({
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
