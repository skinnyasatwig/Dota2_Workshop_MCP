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

export interface MapOverviewImageSize {
  width: number;
  height: number;
}

export interface MapOverviewUv {
  u: number;
  v: number;
}

export interface MapOverviewWorldPoint {
  x: number;
  y: number;
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
  displayQuarterTurnsClockwise?: 0 | 1;
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
  const rotate = object.rotate === undefined ? 0 : finiteNumber(object.rotate, "rotate");
  if (!Number.isInteger(rotate)) {
    throw new Error('Overview key "rotate" must be an integer. Valve treats it as a legacy 0/nonzero flag, not an angle.');
  }
  return {
    name: wrapper.key,
    material: scalar(object.material, "material").replace(/\\/g, "/"),
    posX: finiteNumber(object.pos_x, "pos_x"),
    posY: finiteNumber(object.pos_y, "pos_y"),
    scale,
    rotate,
    zoom: object.zoom === undefined ? undefined : finiteNumber(object.zoom, "zoom"),
  };
}

/**
 * Valve's overview `rotate` key is a legacy boolean. The Source client reads it
 * with GetInt() and applies one 90-degree map turn for every nonzero value.
 * Some Valve Dota overviews even ship values such as 15, so do not interpret
 * the raw number as degrees.
 */
export function mapOverviewDisplayQuarterTurns(metadata: Pick<MapOverviewMetadata, "rotate">): 0 | 1 {
  if (!Number.isInteger(metadata.rotate)) {
    throw new Error("Overview rotate must be an integer legacy flag.");
  }
  return metadata.rotate === 0 ? 0 : 1;
}

function validateTransformMetadata(
  metadata: Pick<MapOverviewMetadata, "posX" | "posY" | "scale" | "rotate">,
): void {
  if (![metadata.posX, metadata.posY, metadata.scale].every(Number.isFinite) || !(metadata.scale > 0)) {
    throw new Error("Overview pos_x, pos_y, and positive scale must be finite.");
  }
  mapOverviewDisplayQuarterTurns(metadata);
}

function validateImageSize(image: MapOverviewImageSize, rotated: boolean): void {
  if (![image.width, image.height].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error("Overview image dimensions must be positive integers.");
  }
  if (rotated && image.width !== image.height) {
    throw new Error("Valve's rotated overview transform requires a square image.");
  }
}

function validateUv(point: MapOverviewUv): void {
  if (![point.u, point.v].every(Number.isFinite)) throw new Error("Overview u/v coordinates must be finite.");
}

/** Convert a displayed minimap coordinate to its source-image coordinate. */
export function mapOverviewDisplayUvToImageUv(
  metadata: Pick<MapOverviewMetadata, "rotate">,
  point: MapOverviewUv,
): MapOverviewUv {
  validateUv(point);
  return mapOverviewDisplayQuarterTurns(metadata) === 0
    ? { u: point.u, v: point.v }
    : { u: point.v, v: 1 - point.u };
}

/** Convert a source-image coordinate to its displayed minimap coordinate. */
export function mapOverviewImageUvToDisplayUv(
  metadata: Pick<MapOverviewMetadata, "rotate">,
  point: MapOverviewUv,
): MapOverviewUv {
  validateUv(point);
  return mapOverviewDisplayQuarterTurns(metadata) === 0
    ? { u: point.u, v: point.v }
    : { u: 1 - point.v, v: point.u };
}

/** Convert a normalized coordinate on the displayed minimap into Dota world X/Y. */
export function mapOverviewDisplayUvToWorld(
  metadata: Pick<MapOverviewMetadata, "posX" | "posY" | "scale" | "rotate">,
  image: MapOverviewImageSize,
  point: MapOverviewUv,
): MapOverviewWorldPoint {
  validateTransformMetadata(metadata);
  const rotated = mapOverviewDisplayQuarterTurns(metadata) !== 0;
  validateImageSize(image, rotated);
  const imagePoint = mapOverviewDisplayUvToImageUv(metadata, point);
  return {
    x: metadata.posX + imagePoint.u * image.width * metadata.scale,
    y: metadata.posY - imagePoint.v * image.height * metadata.scale,
  };
}

/** Convert Dota world X/Y into a normalized coordinate on the displayed minimap. */
export function mapOverviewWorldToDisplayUv(
  metadata: Pick<MapOverviewMetadata, "posX" | "posY" | "scale" | "rotate">,
  image: MapOverviewImageSize,
  point: MapOverviewWorldPoint,
): MapOverviewUv {
  validateTransformMetadata(metadata);
  const rotated = mapOverviewDisplayQuarterTurns(metadata) !== 0;
  validateImageSize(image, rotated);
  if (![point.x, point.y].every(Number.isFinite)) throw new Error("Overview world coordinates must be finite.");
  const imagePoint = {
    u: (point.x - metadata.posX) / (image.width * metadata.scale),
    v: (metadata.posY - point.y) / (image.height * metadata.scale),
  };
  return mapOverviewImageUvToDisplayUv(metadata, imagePoint);
}

/** Axis-aligned world coverage of all four displayed minimap corners. */
export function mapOverviewProjectedBounds(
  metadata: Pick<MapOverviewMetadata, "posX" | "posY" | "scale" | "rotate">,
  image: MapOverviewImageSize,
): MapOverviewBounds {
  const corners = [
    mapOverviewDisplayUvToWorld(metadata, image, { u: 0, v: 0 }),
    mapOverviewDisplayUvToWorld(metadata, image, { u: 1, v: 0 }),
    mapOverviewDisplayUvToWorld(metadata, image, { u: 0, v: 1 }),
    mapOverviewDisplayUvToWorld(metadata, image, { u: 1, v: 1 }),
  ];
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
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

  try {
    report.displayQuarterTurnsClockwise = mapOverviewDisplayQuarterTurns(report.metadata);
    report.projectedBounds = mapOverviewProjectedBounds(report.metadata, report.image);
  } catch (error) {
    report.findings.push({
      severity: "error",
      code: "minimap-transform-invalid",
      detail: error instanceof Error ? error.message : String(error),
    });
    return report;
  }
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
