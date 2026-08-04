import { ParsedMapEntity } from "./vmap.js";
import {
  inspectVpkModelPhysics,
  ModelPhysicsBounds,
  ModelPhysicsInspection,
} from "./model-physics.js";

export type MapCollisionObstacleKind = "tree" | "point-obstruction" | "solid-prop";
export type MapCollisionConfidence =
  | "physical-model-bounds"
  | "class-approximation"
  | "unknown-model-bounds";

export interface MapCollisionFootprint {
  /** Conservative oriented rectangle derived from one physical hull's local bounds. */
  points: [number, number][];
  minZ: number;
  maxZ: number;
  localBounds: ModelPhysicsBounds;
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
) => Promise<ModelPhysicsInspection>;

function transformedFootprints(
  entity: ParsedMapEntity,
  bounds: readonly ModelPhysicsBounds[],
): MapCollisionFootprint[] | undefined {
  const origin = vector3(entity.origin);
  if (!origin) return undefined;
  const angles = vector3(entity.angles) ?? [0, 0, 0];
  // A full pitched/rolled Source transform is easy to get subtly wrong. Refuse to promote
  // those props rather than claiming a trustworthy footprint from a yaw-only projection.
  if (Math.abs(angles[0]) > 1e-6 || Math.abs(angles[2]) > 1e-6) return undefined;
  const scales = vector3(entity.scales) ?? [1, 1, 1];
  const yaw = (angles[1] * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return bounds.map((localBounds) => {
    const xs = [localBounds.min[0] * scales[0], localBounds.max[0] * scales[0]];
    const ys = [localBounds.min[1] * scales[1], localBounds.max[1] * scales[1]];
    const localCorners: [number, number][] = [
      [xs[0], ys[0]],
      [xs[1], ys[0]],
      [xs[1], ys[1]],
      [xs[0], ys[1]],
    ];
    const zs = [
      origin[2] + localBounds.min[2] * scales[2],
      origin[2] + localBounds.max[2] * scales[2],
    ];
    return {
      points: localCorners.map(([x, y]) => [
        origin[0] + x * cos - y * sin,
        origin[1] + x * sin + y * cos,
      ]),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      localBounds,
    };
  });
}

/**
 * Resolve collision-enabled props against the base Dota VPK. Only a non-empty model PHYS block
 * promotes an unknown prop to physical-model-bounds; render/hitbox bounds are never substituted.
 */
export async function resolveMapCollisionObstacles(
  entities: readonly ParsedMapEntity[],
  vpk: string,
  inspect: ModelPhysicsInspector = inspectVpkModelPhysics,
): Promise<MapCollisionObstacle[]> {
  const obstacles = collectMapCollisionObstacles(entities);
  const modelInspections = new Map<string, Promise<ModelPhysicsInspection>>();
  const inspectionFor = (model: string) => {
    const key = model.toLowerCase();
    let inspection = modelInspections.get(key);
    if (!inspection) {
      inspection = inspect(vpk, model);
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
      const footprints = transformedFootprints(entity, inspection.bounds);
      if (!footprints?.length) {
        obstacle.reason = "Physical bounds exist, but pitched/rolled or malformed transforms cannot be projected safely.";
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
