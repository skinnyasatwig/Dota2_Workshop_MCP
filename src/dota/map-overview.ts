import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { blockToObject, findWrapper, parseKV } from "../kv/index.js";
import { pathExists } from "../util/fsx.js";
import { parseMapEntities } from "./vmap.js";

export interface MapOverviewMetadata {
  name: string;
  material: string;
  posX: number;
  posY: number;
  scale: number;
  rotate: number;
  zoom?: number;
}

export interface MapOverviewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapOverviewFinding {
  severity: "error" | "warn";
  code: string;
  detail: string;
}

export interface MapOverviewReport {
  configured: boolean;
  overviewPath: string;
  materialPath?: string;
  texturePath?: string;
  compiledMaterialPath?: string;
  compiledTexturePath?: string;
  metadata?: MapOverviewMetadata;
  image?: { width: number; height: number };
  entityBounds?: MapOverviewBounds;
  projectedBounds?: MapOverviewBounds;
  findings: MapOverviewFinding[];
}

function scalar(value: unknown, key: string): string {
  if (typeof value !== "string") throw new Error(`Overview key "${key}" must have exactly one scalar value.`);
  return value;
}

function finiteNumber(value: unknown, key: string): number {
  const parsed = Number(scalar(value, key));
  if (!Number.isFinite(parsed)) throw new Error(`Overview key "${key}" must be a finite number.`);
  return parsed;
}

/** Parse Valve's resource/overviews/<map>.txt KeyValues file. */
export function parseMapOverviewMetadata(text: string): MapOverviewMetadata {
  const wrapper = findWrapper(parseKV(text));
  if (!wrapper || typeof wrapper.value === "string") throw new Error("Overview must contain one named KeyValues block.");
  const object = blockToObject(wrapper.value);
  const scale = finiteNumber(object.scale, "scale");
  if (!(scale > 0)) throw new Error('Overview key "scale" must be greater than zero.');
  return {
    name: wrapper.key,
    material: scalar(object.material, "material").replace(/\\/g, "/"),
    posX: finiteNumber(object.pos_x, "pos_x"),
    posY: finiteNumber(object.pos_y, "pos_y"),
    scale,
    rotate: object.rotate === undefined ? 0 : finiteNumber(object.rotate, "rotate"),
    zoom: object.zoom === undefined ? undefined : finiteNumber(object.zoom, "zoom"),
  };
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  if (buffer.length < 24 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return undefined;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function vector3(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts as [number, number, number] : undefined;
}

function minimapEntityBounds(mapText: string): { bounds?: MapOverviewBounds; count: number; invalid: number } {
  const entities = parseMapEntities(mapText).filter((entity) => entity.classname === "dota_minimap_boundary");
  const points = entities.map((entity) => vector3(entity.origin)).filter((point): point is [number, number, number] => !!point);
  if (!points.length) return { count: entities.length, invalid: entities.length };
  return {
    count: entities.length,
    invalid: entities.length - points.length,
    bounds: {
      minX: Math.min(...points.map((point) => point[0])),
      minY: Math.min(...points.map((point) => point[1])),
      maxX: Math.max(...points.map((point) => point[0])),
      maxY: Math.max(...points.map((point) => point[1])),
    },
  };
}

function safeAssetPath(root: string, assetPath: string, extension: string): string {
  const normalized = assetPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (isAbsolute(assetPath) || normalized.split("/").includes("..") || !normalized.toLowerCase().endsWith(extension)) {
    throw new Error(`Unsafe or unsupported overview asset path: ${assetPath}`);
  }
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, ...normalized.split("/"));
  if (candidate !== rootPath && !candidate.startsWith(rootPath + sep)) {
    throw new Error(`Overview asset escapes the addon tree: ${assetPath}`);
  }
  return candidate;
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function compareBounds(
  actual: MapOverviewBounds,
  expected: MapOverviewBounds,
  tolerance: number,
): string[] {
  return (["minX", "minY", "maxX", "maxY"] as const)
    .filter((key) => !near(actual[key], expected[key], tolerance))
    .map((key) => `${key}=${actual[key]} (expected ${expected[key]})`);
}

function parseMaterialTexture(text: string): string {
  const wrapper = findWrapper(parseKV(text));
  if (!wrapper || typeof wrapper.value === "string") throw new Error("Overview VMAT must contain one named KeyValues block.");
  const texture = blockToObject(wrapper.value).Texture;
  return scalar(texture, "Texture").replace(/\\/g, "/");
}

async function findCompiledTexture(gameDir: string, sourceTexture: string): Promise<string | undefined> {
  // The content and game roots mirror each other, but Source 2 names PNG-derived textures
  // either <stem>.vtex_c or <stem>_png_<hash>.vtex_c depending on the compiler build.
  const normalized = sourceTexture.replace(/\\/g, "/");
  const marker = "/materials/";
  const markerIndex = normalized.toLowerCase().lastIndexOf(marker);
  const assetRelative = markerIndex >= 0 ? normalized.slice(markerIndex + 1) : normalized;
  const sourceName = basename(assetRelative);
  const stem = sourceName.replace(/\.[^.]+$/, "");
  const extension = sourceName.split(".").pop()?.toLowerCase() ?? "png";
  const compiledDirectory = join(gameDir, dirname(assetRelative));
  if (!(await pathExists(compiledDirectory))) return undefined;
  const candidates = await readdir(compiledDirectory);
  const direct = `${stem}.vtex_c`.toLowerCase();
  const hashedPrefix = `${stem}_${extension}_`.toLowerCase();
  const match = candidates.find((candidate) => {
    const lower = candidate.toLowerCase();
    return lower === direct || (lower.startsWith(hashedPrefix) && lower.endsWith(".vtex_c"));
  });
  return match ? join(compiledDirectory, match) : undefined;
}

export interface InspectMapOverviewOptions {
  mapName: string;
  mapText: string;
  gameDir: string;
  contentDir: string;
  requireCompiledAssets?: boolean;
}

/** Validate minimap metadata, assets, and the world-to-image transform without launching Dota. */
export async function inspectMapOverview(options: InspectMapOverviewOptions): Promise<MapOverviewReport> {
  const overviewPath = join(options.gameDir, "resource", "overviews", `${options.mapName}.txt`);
  const report: MapOverviewReport = { configured: false, overviewPath, findings: [] };
  const boundaries = minimapEntityBounds(options.mapText);
  report.entityBounds = boundaries.bounds;
  if (boundaries.invalid) {
    report.findings.push({ severity: "error", code: "minimap-boundary-origin-invalid", detail: `${boundaries.invalid} minimap boundary entity origin(s) are invalid.` });
  }
  if (boundaries.count !== 0 && boundaries.count !== 2) {
    report.findings.push({ severity: "error", code: "minimap-boundary-count", detail: `Expected exactly two dota_minimap_boundary entities, found ${boundaries.count}.` });
  }

  if (!(await pathExists(overviewPath))) {
    report.findings.push({
      severity: boundaries.count ? "error" : "warn",
      code: boundaries.count ? "minimap-overview-missing" : "minimap-unconfigured",
      detail: boundaries.count
        ? `Minimap boundaries exist but overview metadata is missing: ${overviewPath}`
        : "No minimap boundary entities or overview metadata are configured.",
    });
    return report;
  }
  report.configured = true;
  if (!boundaries.count) {
    report.findings.push({ severity: "error", code: "minimap-boundaries-missing", detail: "Overview metadata exists but the map has no dota_minimap_boundary entities." });
  }

  try {
    report.metadata = parseMapOverviewMetadata(await readFile(overviewPath, "utf8"));
  } catch (error) {
    report.findings.push({ severity: "error", code: "minimap-overview-invalid", detail: error instanceof Error ? error.message : String(error) });
    return report;
  }
  if (report.metadata.name !== options.mapName) {
    report.findings.push({ severity: "warn", code: "minimap-overview-name", detail: `Overview wrapper is "${report.metadata.name}" rather than "${options.mapName}".` });
  }

  try {
    report.materialPath = safeAssetPath(options.contentDir, report.metadata.material, ".vmat");
  } catch (error) {
    report.findings.push({ severity: "error", code: "minimap-material-path-invalid", detail: error instanceof Error ? error.message : String(error) });
    return report;
  }
  if (!(await pathExists(report.materialPath))) {
    report.findings.push({ severity: "error", code: "minimap-material-missing", detail: `Overview material is missing: ${report.materialPath}` });
    return report;
  }

  let textureAsset: string;
  try {
    textureAsset = parseMaterialTexture(await readFile(report.materialPath, "utf8"));
    report.texturePath = safeAssetPath(options.contentDir, textureAsset, ".png");
  } catch (error) {
    report.findings.push({ severity: "error", code: "minimap-material-invalid", detail: error instanceof Error ? error.message : String(error) });
    return report;
  }
  if (!(await pathExists(report.texturePath))) {
    report.findings.push({ severity: "error", code: "minimap-texture-missing", detail: `Overview texture is missing: ${report.texturePath}` });
    return report;
  }
  report.image = pngDimensions(await readFile(report.texturePath));
  if (!report.image) {
    report.findings.push({ severity: "error", code: "minimap-texture-invalid", detail: `Overview texture is not a valid PNG: ${report.texturePath}` });
    return report;
  }

  report.compiledMaterialPath = join(options.gameDir, `${report.metadata.material}_c`);
  report.compiledTexturePath = await findCompiledTexture(options.gameDir, report.texturePath);
  const compiledSeverity = options.requireCompiledAssets ? "error" as const : "warn" as const;
  if (!(await pathExists(report.compiledMaterialPath))) {
    report.findings.push({ severity: compiledSeverity, code: "minimap-material-compiled-missing", detail: `Compiled overview material is missing: ${report.compiledMaterialPath}` });
  }
  if (!report.compiledTexturePath) {
    report.findings.push({ severity: compiledSeverity, code: "minimap-texture-compiled-missing", detail: `Compiled overview texture is missing for: ${report.texturePath}` });
  }

  if (report.metadata.rotate !== 0) {
    report.findings.push({ severity: "warn", code: "minimap-rotation-unverified", detail: `Overview rotate=${report.metadata.rotate}; automatic world-bound verification currently supports rotate=0 only.` });
    return report;
  }
  report.projectedBounds = {
    minX: report.metadata.posX,
    maxX: report.metadata.posX + report.image.width * report.metadata.scale,
    maxY: report.metadata.posY,
    minY: report.metadata.posY - report.image.height * report.metadata.scale,
  };
  if (report.entityBounds && boundaries.count === 2) {
    const mismatch = compareBounds(report.projectedBounds, report.entityBounds, Math.max(1e-4, report.metadata.scale * 0.01));
    if (mismatch.length) {
      report.findings.push({
        severity: "error",
        code: "minimap-transform-mismatch",
        detail: `Overview metadata/image projects to different world bounds than dota_minimap_boundary: ${mismatch.join(", ")}.`,
      });
    }
  }
  return report;
}
