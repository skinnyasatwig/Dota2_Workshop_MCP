import { ParsedMapEntity } from "./vmap.js";

export type MapCollisionObstacleKind = "tree" | "point-obstruction" | "solid-prop";
export type MapCollisionConfidence = "class-approximation" | "unknown-model-bounds";

export interface MapCollisionObstacle {
  id: string;
  targetname?: string;
  classname: string;
  origin: [number, number, number];
  kind: MapCollisionObstacleKind;
  confidence: MapCollisionConfidence;
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
      targetname: entity.targetname,
      classname: entity.classname,
      origin,
      kind: "solid-prop",
      confidence: "unknown-model-bounds",
      reason: "The prop is collision-enabled, but its model collision bounds are not exposed by FGD.",
    });
  }
  return obstacles;
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
