import { ParsedMapEntity } from "./vmap.js";
import { join } from "node:path";
import { pathExists } from "../util/fsx.js";
import {
  inspectCompiledModelPhysics,
  inspectVpkModelPhysics,
  ModelPhysicsBounds,
  ModelPhysicsInspection,
  ModelPhysicsPrimitive,
  normalizeCompiledModelPath,
} from "./model-physics.js";

export type MapCollisionObstacleKind = "tree" | "point-obstruction" | "solid-prop";
export type MapCollisionConfidence =
  | "physical-model-bounds"
  | "class-approximation"
  | "unknown-model-bounds";

export interface MapCollisionFootprint {
  /** Convex XY projection from exact hulls, curved primitive supports, or a conservative fallback. */
  points: [number, number][];
  minZ: number;
  maxZ: number;
  localBounds: ModelPhysicsBounds;
  projection: "exact-hull" | "mesh-vertex-hull" | "curved-primitive" | "bounds";
}

export interface MapCollisionObstacle {
  id: string;
  sourceIndex: number;
  targetname?: string;
  classname: string;
  origin: [number, number, number];
  kind: MapCollisionObstacleKind;
  confidence: MapCollisionConfidence;
  model?: string;
  physicalFootprints?: MapCollisionFootprint[];
  /** Conservative XY broad-phase only; this is not the model's exact collision hull. */
  approximateRadius?: number;
  reason: string;
}

// Valve declares these classes as navigation obstructions but does not expose their exact
// collision hull through FGD. Keep this radius deliberately small and report proximity as a
// warning, never as proof that Valve's final navmesh is blocked.
export const DOTA_OBSTRUCTION_BROAD_PHASE_RADIUS = 64;

const SOLID_PROP_CLASSES = new Set([
  "prop_static",
  "prop_dynamic",
  "prop_dynamic_override",
  "prop_physics",
  "prop_physics_override",
  "dota_prop_customtexture",
]);

function vector3(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const numbers = value.trim().split(/\s+/).map(Number);
  if (numbers.length !== 3 || numbers.some((number) => !Number.isFinite(number))) return undefined;
  return numbers as [number, number, number];
}

function modelPath(entity: ParsedMapEntity): string | undefined {
  return entity.properties.model ?? entity.properties.Model ?? entity.properties.modelname;
}

function numericFlags(entity: ParsedMapEntity): number {
  const parsed = Number(entity.properties.spawnflags ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function obstacleId(entity: ParsedMapEntity, index: number): string {
  return entity.targetname || `${entity.classname}#${entity.nodeId ?? index + 1}`;
}

/**
 * Extract only collision facts that can be recovered safely from VMAP entities.
 *
 * Trees and point_simple_obstruction are explicit Valve navigation-obstruction classes, but their
 * exact hull size is unavailable in FGD, so they receive a small warning-only broad phase. Solid
 * props are reported for preview awareness without an invented footprint. Nav-ignore and initially
 * collision-disabled flags are honored where Valve declares them.
 */
export function collectMapCollisionObstacles(
  entities: readonly ParsedMapEntity[],
): MapCollisionObstacle[] {
  const obstacles: MapCollisionObstacle[] = [];
  for (const [index, entity] of entities.entries()) {
    const origin = vector3(entity.origin);
    if (!origin) continue;
    const classname = entity.classname.toLowerCase();
    const flags = numericFlags(entity);
    const navIgnored = (flags & 512) !== 0;
    if (navIgnored) continue;

    if (classname === "ent_dota_tree") {
      obstacles.push({
        id: obstacleId(entity, index),
        sourceIndex: index,
        targetname: entity.targetname,
        classname: entity.classname,
        origin,
        kind: "tree",
        confidence: "class-approximation",
        approximateRadius: DOTA_OBSTRUCTION_BROAD_PHASE_RADIUS,
        reason: "Valve declares ent_dota_tree as collision and a Dota obstruction.",
      });
      continue;
    }
    if (classname === "point_simple_obstruction") {
      if (["1", "true", "yes"].includes((entity.properties.StartDisabled ?? "0").toLowerCase())) {
        continue;
      }
      obstacles.push({
        id: obstacleId(entity, index),
        sourceIndex: index,
        targetname: entity.targetname,
        classname: entity.classname,
        origin,
        kind: "point-obstruction",
        confidence: "class-approximation",
        approximateRadius: DOTA_OBSTRUCTION_BROAD_PHASE_RADIUS,
        reason: "Valve declares point_simple_obstruction as a Dota obstruction.",
      });
      continue;
    }
    if (!SOLID_PROP_CLASSES.has(classname)) continue;
    if (entity.properties.solid === "0") continue;
    const collisionInitiallyDisabled = classname.startsWith("prop_dynamic") && (flags & 256) !== 0;
    if (collisionInitiallyDisabled) continue;
    obstacles.push({
      id: obstacleId(entity, index),
      sourceIndex: index,
      targetname: entity.targetname,
      classname: entity.classname,
      origin,
      kind: "solid-prop",
      confidence: "unknown-model-bounds",
      model: modelPath(entity),
      reason: "The prop is collision-enabled, but its model PHYS bounds have not been resolved.",
    });
  }
  return obstacles;
}

export type ModelPhysicsInspector = (
  vpk: string,
  model: string,
  sourceLabel?: string,
) => Promise<ModelPhysicsInspection>;

export type CompiledModelPhysicsInspector = (
  compiledModelFile: string,
  model?: string,
) => Promise<ModelPhysicsInspection>;

export interface MapCollisionResolutionOptions {
  /** Loose compiled addon roots, normally the active project's game directory. */
  compiledModelRoots?: readonly string[];
  /** Packed addon archives checked after loose files and before the base Dota VPK. */
  compiledModelVpks?: readonly string[];
  inspectCompiledModel?: CompiledModelPhysicsInspector;
}

export type SourceAngleMatrix = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/**
 * Build Valve's left-handed QAngle matrix for [pitch, yaw, roll] in degrees.
 *
 * The formula and multiplication order match Valve's published AngleMatrix implementation:
 * https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/mathlib/mathlib_base.cpp
 */
export function sourceAngleMatrix(
  angles: readonly [number, number, number],
): SourceAngleMatrix {
  const pitch = (angles[0] * Math.PI) / 180;
  const yaw = (angles[1] * Math.PI) / 180;
  const roll = (angles[2] * Math.PI) / 180;
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const crcy = cr * cy;
  const crsy = cr * sy;
  const srcy = sr * cy;
  const srsy = sr * sy;
  return [
    [cp * cy, sp * srcy - crsy, sp * crcy + srsy],
    [cp * sy, sp * srsy + crcy, sp * crsy - srcy],
    [-sp, sr * cp, cr * cp],
  ];
}

function transformSourcePoint(
  matrix: SourceAngleMatrix,
  point: readonly [number, number, number],
  origin: readonly [number, number, number],
): [number, number, number] {
  return [
    origin[0] + matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2],
    origin[1] + matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2],
    origin[2] + matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2],
  ];
}

function transformSourceDirection(
  matrix: SourceAngleMatrix,
  direction: readonly [number, number, number],
): [number, number, number] {
  return [
    matrix[0][0] * direction[0] + matrix[0][1] * direction[1] + matrix[0][2] * direction[2],
    matrix[1][0] * direction[0] + matrix[1][1] * direction[1] + matrix[1][2] * direction[2],
    matrix[2][0] * direction[0] + matrix[2][1] * direction[1] + matrix[2][2] * direction[2],
  ];
}

function clipToHalfPlane(
  polygon: readonly [number, number][],
  normal: readonly [number, number],
  support: number,
): [number, number][] {
  if (!polygon.length) return [];
  const output: [number, number][] = [];
  const signed = (point: readonly [number, number]) =>
    point[0] * normal[0] + point[1] * normal[1] - support;
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentDistance = signed(current);
    const previousDistance = signed(previous);
    const currentInside = currentDistance <= 1e-8;
    const previousInside = previousDistance <= 1e-8;
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      if (Math.abs(denominator) > 1e-12) {
        const amount = previousDistance / denominator;
        output.push([
          previous[0] + (current[0] - previous[0]) * amount,
          previous[1] + (current[1] - previous[1]) * amount,
        ]);
      }
    }
    if (currentInside) output.push([...current]);
  }
  return output;
}

/** Build a 32-tangent outer polygon from the exact support function of a transformed sphere/capsule. */
function curvedPrimitiveFootprint(
  primitive: ModelPhysicsPrimitive,
  localBounds: ModelPhysicsBounds,
  matrix: SourceAngleMatrix,
  scales: readonly [number, number, number],
  origin: readonly [number, number, number],
): MapCollisionFootprint | undefined {
  if (
    (primitive.kind === "sphere" && primitive.centers.length !== 1) ||
    (primitive.kind === "capsule" && primitive.centers.length !== 2) ||
    primitive.radiusVectors.length !== 3
  ) return undefined;
  const scaled = (point: readonly [number, number, number]): [number, number, number] => [
    point[0] * scales[0],
    point[1] * scales[1],
    point[2] * scales[2],
  ];
  const centers = primitive.centers.map((center) =>
    transformSourcePoint(matrix, scaled(center), origin));
  const radiusVectors = primitive.radiusVectors.map((vector) =>
    transformSourceDirection(matrix, scaled(vector)));
  if (
    centers.some((point) => point.some((coordinate) => !Number.isFinite(coordinate))) ||
    radiusVectors.some((point) => point.some((coordinate) => !Number.isFinite(coordinate)))
  ) return undefined;

  const xyRadiusBound = radiusVectors.reduce(
    (sum, vector) => sum + Math.hypot(vector[0], vector[1]),
    0,
  );
  const extent = Math.max(
    1,
    ...centers.flatMap((center) => [Math.abs(center[0]), Math.abs(center[1])]),
  ) + xyRadiusBound + 1;
  let points: [number, number][] = [
    [-extent, -extent],
    [extent, -extent],
    [extent, extent],
    [-extent, extent],
  ];
  const tangentCount = 32;
  for (let index = 0; index < tangentCount; index++) {
    const angle = (index / tangentCount) * Math.PI * 2;
    const normal: [number, number] = [Math.cos(angle), Math.sin(angle)];
    const centerSupport = Math.max(...centers.map((center) =>
      center[0] * normal[0] + center[1] * normal[1]));
    const radiusSupport = Math.hypot(...radiusVectors.map((vector) =>
      vector[0] * normal[0] + vector[1] * normal[1]));
    points = clipToHalfPlane(points, normal, centerSupport + radiusSupport);
    if (points.length < 3) return undefined;
  }
  const zRadius = Math.hypot(...radiusVectors.map((vector) => vector[2]));
  return {
    points,
    minZ: Math.min(...centers.map((center) => center[2])) - zRadius,
    maxZ: Math.max(...centers.map((center) => center[2])) + zRadius,
    localBounds,
    projection: "curved-primitive",
  };
}

function convexHull2d(points: readonly [number, number][]): [number, number][] {
  const epsilon = 1e-9;
  const sorted = [...points]
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])
    .filter((point, index, all) => index === 0 ||
      Math.abs(point[0] - all[index - 1][0]) > epsilon ||
      Math.abs(point[1] - all[index - 1][1]) > epsilon);
  if (sorted.length < 3) return [];
  const cross = (
    origin: readonly [number, number],
    left: readonly [number, number],
    right: readonly [number, number],
  ) => (left[0] - origin[0]) * (right[1] - origin[1]) -
    (left[1] - origin[1]) * (right[0] - origin[0]);
  const half = (input: readonly [number, number][]) => {
    const output: [number, number][] = [];
    for (const point of input) {
      while (output.length >= 2 && cross(output.at(-2)!, output.at(-1)!, point) <= epsilon) {
        output.pop();
      }
      output.push(point);
    }
    return output;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Project checked local model bounds through a VMAP entity transform into world-space footprints. */
export function transformModelBoundsFootprints(
  entity: ParsedMapEntity,
  bounds: readonly ModelPhysicsBounds[],
): MapCollisionFootprint[] | undefined {
  const origin = vector3(entity.origin);
  if (!origin) return undefined;
  const angles: [number, number, number] | undefined = entity.angles === undefined
    ? [0, 0, 0]
    : vector3(entity.angles);
  const scales: [number, number, number] | undefined = entity.scales === undefined
    ? [1, 1, 1]
    : vector3(entity.scales);
  if (!angles || !scales || scales.some((scale) => Math.abs(scale) <= 1e-9)) return undefined;
  const matrix = sourceAngleMatrix(angles);
  const footprints = bounds.map((localBounds) => {
    if (localBounds.primitive) {
      const curved = curvedPrimitiveFootprint(localBounds.primitive, localBounds, matrix, scales, origin);
      if (curved) return curved;
    }
    const xs = [localBounds.min[0] * scales[0], localBounds.max[0] * scales[0]];
    const ys = [localBounds.min[1] * scales[1], localBounds.max[1] * scales[1]];
    const zs = [localBounds.min[2] * scales[2], localBounds.max[2] * scales[2]];
    const localPoints: [number, number, number][] = localBounds.vertices?.length
      ? localBounds.vertices.map((vertex) => [
          vertex[0] * scales[0],
          vertex[1] * scales[1],
          vertex[2] * scales[2],
        ])
      : [];
    if (!localPoints.length) {
      for (const x of xs) {
        for (const y of ys) {
          for (const z of zs) localPoints.push([x, y, z]);
        }
      }
    }
    const transformed: [number, number, number][] = [];
    for (const point of localPoints) transformed.push(transformSourcePoint(matrix, point, origin));
    if (transformed.some((point) => point.some((coordinate) => !Number.isFinite(coordinate)))) {
      return undefined;
    }
    const points = convexHull2d(transformed.map((point) => [point[0], point[1]]));
    if (points.length < 3) return undefined;
    return {
      points,
      minZ: Math.min(...transformed.map((point) => point[2])),
      maxZ: Math.max(...transformed.map((point) => point[2])),
      localBounds,
      projection: localBounds.geometry === "convex-hull"
        ? "exact-hull"
        : localBounds.geometry === "mesh-vertex-hull"
          ? "mesh-vertex-hull"
          : "bounds",
    };
  });
  if (footprints.some((footprint) => footprint === undefined)) return undefined;
  return footprints as MapCollisionFootprint[];
}

/**
 * Resolve collision-enabled props against the base Dota VPK. Only a non-empty model PHYS block
 * promotes an unknown prop to physical-model-bounds; render/hitbox bounds are never substituted.
 */
export async function resolveMapCollisionObstacles(
  entities: readonly ParsedMapEntity[],
  vpk: string,
  inspect: ModelPhysicsInspector = inspectVpkModelPhysics,
  options: MapCollisionResolutionOptions = {},
): Promise<MapCollisionObstacle[]> {
  const obstacles = collectMapCollisionObstacles(entities);
  const modelInspections = new Map<string, Promise<ModelPhysicsInspection>>();
  const inspectionFor = (model: string) => {
    const key = model.toLowerCase();
    let inspection = modelInspections.get(key);
    if (!inspection) {
      inspection = (async () => {
        const compiledModel = normalizeCompiledModelPath(model);
        if (compiledModel) {
          for (const root of options.compiledModelRoots ?? []) {
            const candidate = join(root, ...compiledModel.split("/"));
            if (await pathExists(candidate)) {
              return (options.inspectCompiledModel ?? inspectCompiledModelPhysics)(candidate, model);
            }
          }
        }
        for (const addonVpk of options.compiledModelVpks ?? []) {
          if (!(await pathExists(addonVpk))) continue;
          const addonInspection = await inspect(addonVpk, model, "compiled-addon VPK");
          if (!/^The model was not found in the compiled-addon VPK\.$/.test(addonInspection.detail)) {
            return addonInspection;
          }
        }
        return inspect(vpk, model);
      })();
      modelInspections.set(key, inspection);
    }
    return inspection;
  };

  // Keep external helper pressure low while maps contain many unique decorative props.
  const unresolved = obstacles.filter(
    (obstacle) => obstacle.confidence === "unknown-model-bounds" && obstacle.model,
  );
  let cursor = 0;
  const workers = new Array(Math.min(2, unresolved.length)).fill(undefined).map(async () => {
    while (cursor < unresolved.length) {
      const obstacle = unresolved[cursor++];
      const entity = entities[obstacle.sourceIndex];
      if (!entity || !obstacle.model) continue;
      let inspection: ModelPhysicsInspection;
      try {
        inspection = await inspectionFor(obstacle.model);
      } catch (cause) {
        obstacle.reason = `Model PHYS inspection failed safely: ${cause instanceof Error ? cause.message : String(cause)}`;
        continue;
      }
      if (inspection.status !== "physical-bounds") {
        obstacle.reason = inspection.detail;
        continue;
      }
      const footprints = transformModelBoundsFootprints(entity, inspection.bounds);
      if (!footprints?.length) {
        obstacle.reason = "Physical bounds exist, but a malformed or degenerate transform cannot be projected safely.";
        continue;
      }
      obstacle.confidence = "physical-model-bounds";
      obstacle.physicalFootprints = footprints;
      obstacle.reason = `${inspection.detail}${inspection.fromCache ? " Cached result reused." : ""}`;
    }
  });
  await Promise.all(workers);
  return obstacles;
}

export function pointInPolygon(
  point: readonly [number, number],
  polygon: readonly [number, number][],
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    const intersects =
      y > point[1] !== previousY > point[1] &&
      point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y || Number.EPSILON) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const epsilon = 1e-7;
  const onSegment = (
    point: readonly [number, number],
    from: readonly [number, number],
    to: readonly [number, number],
  ) => point[0] >= Math.min(from[0], to[0]) - epsilon &&
    point[0] <= Math.max(from[0], to[0]) + epsilon &&
    point[1] >= Math.min(from[1], to[1]) - epsilon &&
    point[1] <= Math.max(from[1], to[1]) + epsilon;
  if (Math.abs(abC) <= epsilon && onSegment(c, a, b)) return true;
  if (Math.abs(abD) <= epsilon && onSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= epsilon && onSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= epsilon && onSegment(b, c, d)) return true;
  return abC * abD < 0 && cdA * cdB < 0;
}

export function segmentIntersectsPolygon(
  from: readonly [number, number],
  to: readonly [number, number],
  polygon: readonly [number, number][],
): boolean {
  if (pointInPolygon(from, polygon) || pointInPolygon(to, polygon)) return true;
  return polygon.some((point, index) =>
    segmentsIntersect(from, to, point, polygon[(index + 1) % polygon.length]));
}

export function physicalObstacleContainsPoint(
  obstacle: MapCollisionObstacle,
  point: readonly [number, number],
  worldZ?: number,
): boolean {
  return obstacle.physicalFootprints?.some((footprint) =>
    (worldZ === undefined || (worldZ >= footprint.minZ && worldZ <= footprint.maxZ)) &&
    pointInPolygon(point, footprint.points)) ?? false;
}

export function segmentIntersectsPhysicalObstacle(
  obstacle: MapCollisionObstacle,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): boolean {
  const minZ = Math.min(from[2], to[2]);
  const maxZ = Math.max(from[2], to[2]);
  return obstacle.physicalFootprints?.some((footprint) =>
    maxZ >= footprint.minZ && minZ <= footprint.maxZ &&
    segmentIntersectsPolygon([from[0], from[1]], [to[0], to[1]], footprint.points)) ?? false;
}

export function distanceToSegment2d(
  point: readonly [number, number],
  from: readonly [number, number],
  to: readonly [number, number],
): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return Math.hypot(point[0] - from[0], point[1] - from[1]);
  const amount = Math.max(
    0,
    Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared),
  );
  return Math.hypot(point[0] - (from[0] + dx * amount), point[1] - (from[1] + dy * amount));
}
