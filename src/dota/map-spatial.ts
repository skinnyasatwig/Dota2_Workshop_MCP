import { z } from "zod";
import type { ManagedMapEntity, ManagedMapPath, MapContract } from "./map-contract.js";
import type { ParsedMapEntity } from "./vmap.js";

const assertionName = z.string().regex(
  /^[A-Za-z_][A-Za-z0-9_.-]*$/,
  "must start with a letter or underscore and contain only letters, digits, _, ., or -",
);
const boundedDistance = z.number().finite().nonnegative().max(32768);

export const spatialAssertionInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("entityDistance"),
    name: assertionName,
    from: z.string().min(1),
    to: z.string().min(1),
    min: boundedDistance.optional(),
    max: boundedDistance.optional(),
  }).strict(),
  z.object({
    kind: z.literal("pathSeparation"),
    name: assertionName,
    pathA: z.string().min(1),
    pathB: z.string().min(1),
    min: boundedDistance.positive(),
  }).strict(),
  z.object({
    kind: z.literal("entityPathDistance"),
    name: assertionName,
    entity: z.string().min(1),
    path: z.string().min(1),
    min: boundedDistance.optional(),
    max: boundedDistance.optional(),
  }).strict(),
]);

export type SpatialAssertion = z.infer<typeof spatialAssertionInputSchema>;

export interface SpatialAssertionResult {
  name: string;
  kind: SpatialAssertion["kind"];
  passed: boolean;
  actualDistance?: number;
  minimum?: number;
  maximum?: number;
  references: [string, string];
  /** Closest planar points, in world units, used to explain and preview the measurement. */
  closestPoints?: [Point2, Point2];
  detail: string;
}

export interface SpatialAssertionSummary {
  total: number;
  passed: number;
  failed: number;
  unresolved: number;
}

export type Point2 = [number, number];

function vector3(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const values = value.trim().split(/\s+/).map(Number);
  return values.length === 3 && values.every(Number.isFinite)
    ? values as [number, number, number]
    : undefined;
}

function parseOrigin(entity: ManagedMapEntity): Point2 | undefined {
  const values = vector3(entity.origin);
  return values ? [values[0], values[1]] : undefined;
}

function closestPointOnSegment(point: Point2, from: Point2, to: Point2): Point2 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return [from[0], from[1]];
  const amount = Math.max(0, Math.min(1,
    ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared));
  return [from[0] + dx * amount, from[1] + dy * amount];
}

function orientation(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(point: Point2, from: Point2, to: Point2): boolean {
  return Math.abs(orientation(from, to, point)) <= 1e-6 &&
    point[0] >= Math.min(from[0], to[0]) - 1e-6 && point[0] <= Math.max(from[0], to[0]) + 1e-6 &&
    point[1] >= Math.min(from[1], to[1]) - 1e-6 && point[1] <= Math.max(from[1], to[1]) + 1e-6;
}

function segmentsIntersect(a0: Point2, a1: Point2, b0: Point2, b1: Point2): boolean {
  const a = orientation(a0, a1, b0);
  const b = orientation(a0, a1, b1);
  const c = orientation(b0, b1, a0);
  const d = orientation(b0, b1, a1);
  if (((a > 1e-6 && b < -1e-6) || (a < -1e-6 && b > 1e-6)) &&
      ((c > 1e-6 && d < -1e-6) || (c < -1e-6 && d > 1e-6))) return true;
  return onSegment(b0, a0, a1) || onSegment(b1, a0, a1) ||
    onSegment(a0, b0, b1) || onSegment(a1, b0, b1);
}

export interface DistanceWitness {
  distance: number;
  points: [Point2, Point2];
}

function sharedSegmentPoint(a0: Point2, a1: Point2, b0: Point2, b1: Point2): Point2 | undefined {
  for (const point of [a0, a1, b0, b1]) {
    if (onSegment(point, a0, a1) && onSegment(point, b0, b1)) return [point[0], point[1]];
  }
  const aDx = a1[0] - a0[0];
  const aDy = a1[1] - a0[1];
  const bDx = b1[0] - b0[0];
  const bDy = b1[1] - b0[1];
  const denominator = aDx * bDy - aDy * bDx;
  if (Math.abs(denominator) <= 1e-6) return undefined;
  const amount = ((b0[0] - a0[0]) * bDy - (b0[1] - a0[1]) * bDx) / denominator;
  return [a0[0] + amount * aDx, a0[1] + amount * aDy];
}

function segmentDistanceWitness(a0: Point2, a1: Point2, b0: Point2, b1: Point2): DistanceWitness {
  if (segmentsIntersect(a0, a1, b0, b1)) {
    const point = sharedSegmentPoint(a0, a1, b0, b1) ?? [a0[0], a0[1]] as Point2;
    return { distance: 0, points: [point, [point[0], point[1]]] };
  }
  const candidates: [Point2, Point2][] = [
    [a0, closestPointOnSegment(a0, b0, b1)],
    [a1, closestPointOnSegment(a1, b0, b1)],
    [closestPointOnSegment(b0, a0, a1), b0],
    [closestPointOnSegment(b1, a0, a1), b1],
  ];
  return candidates
    .map((points) => ({ distance: Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]), points }))
    .reduce((best, candidate) => candidate.distance < best.distance ? candidate : best);
}

function pathSegments(path: ManagedMapPath): [Point2, Point2][] {
  const points = path.points.map(([x, y]) => [x, y] as Point2);
  if (points.length === 1) return [[points[0], points[0]]];
  const segments: [Point2, Point2][] = [];
  for (let index = 1; index < points.length; index++) segments.push([points[index - 1], points[index]]);
  if (path.loop) segments.push([points[points.length - 1], points[0]]);
  return segments;
}

export function minimumPathSeparation(a: ManagedMapPath, b: ManagedMapPath): number {
  return minimumPathSeparationWitness(a, b).distance;
}

export function minimumPathSeparationWitness(a: ManagedMapPath, b: ManagedMapPath): DistanceWitness {
  let minimum: DistanceWitness | undefined;
  for (const [a0, a1] of pathSegments(a)) {
    for (const [b0, b1] of pathSegments(b)) {
      const candidate = segmentDistanceWitness(a0, a1, b0, b1);
      if (!minimum || candidate.distance < minimum.distance) minimum = candidate;
    }
  }
  return minimum ?? { distance: Number.POSITIVE_INFINITY, points: [[0, 0], [0, 0]] };
}

export function minimumPointPathDistanceWitness(point: Point2, path: ManagedMapPath): DistanceWitness {
  let minimum: DistanceWitness | undefined;
  for (const [from, to] of pathSegments(path)) {
    const closest = closestPointOnSegment(point, from, to);
    const candidate: DistanceWitness = {
      distance: Math.hypot(closest[0] - point[0], closest[1] - point[1]),
      points: [[point[0], point[1]], closest],
    };
    if (!minimum || candidate.distance < minimum.distance) minimum = candidate;
  }
  return minimum ?? { distance: Number.POSITIVE_INFINITY, points: [[point[0], point[1]], [point[0], point[1]]] };
}

export function parseSpatialAssertions(
  value: unknown,
  field: string,
  path: string,
): SpatialAssertion[] | undefined {
  if (value === undefined) return undefined;
  const parsed = z.array(spatialAssertionInputSchema).safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${field}${issue.path.length ? `.${issue.path.join(".")}` : ""} ${issue.message}: ${path}`);
  }
  const names = new Set<string>();
  for (const [index, assertion] of parsed.data.entries()) {
    if (names.has(assertion.name)) throw new Error(`${field} contains duplicate name "${assertion.name}": ${path}`);
    names.add(assertion.name);
    if (assertion.kind === "entityDistance" || assertion.kind === "entityPathDistance") {
      if (assertion.kind === "entityDistance" && assertion.from === assertion.to) {
        throw new Error(`${field}[${index}] must reference two different entities: ${path}`);
      }
      if (assertion.min === undefined && assertion.max === undefined) {
        throw new Error(`${field}[${index}] must set min or max: ${path}`);
      }
      if (assertion.min !== undefined && assertion.max !== undefined && assertion.min > assertion.max) {
        throw new Error(`${field}[${index}].min cannot exceed max: ${path}`);
      }
    } else if (assertion.pathA === assertion.pathB) {
      throw new Error(`${field}[${index}] must reference two different paths: ${path}`);
    }
  }
  return parsed.data;
}

function entitiesByName(contract: MapContract): Map<string, Point2> {
  const result = new Map<string, Point2>();
  for (const entity of contract.managedEntities ?? []) {
    const origin = parseOrigin(entity);
    if (origin) result.set(entity.targetname, origin);
  }
  for (const path of contract.managedPaths ?? []) {
    const startIndex = path.startIndex ?? 1;
    for (const [offset, [x, y]] of path.points.entries()) {
      result.set(`${path.name}_${startIndex + offset}`, [x, y]);
    }
  }
  return result;
}

export function evaluateSpatialAssertions(contract: MapContract): SpatialAssertionResult[] {
  const entities = entitiesByName(contract);
  const paths = new Map((contract.managedPaths ?? []).map((path) => [path.name, path]));
  return (contract.spatialAssertions ?? []).map((assertion) => {
    if (assertion.kind === "entityDistance") {
      const from = entities.get(assertion.from);
      const to = entities.get(assertion.to);
      if (!from || !to) {
        const missing = [!from ? assertion.from : undefined, !to ? assertion.to : undefined].filter(Boolean).join(", ");
        return {
          name: assertion.name,
          kind: assertion.kind,
          passed: false,
          minimum: assertion.min,
          maximum: assertion.max,
          references: [assertion.from, assertion.to],
          detail: `Missing managed entity reference(s): ${missing}.`,
        };
      }
      const actualDistance = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const passed = (assertion.min === undefined || actualDistance >= assertion.min - 1e-6) &&
        (assertion.max === undefined || actualDistance <= assertion.max + 1e-6);
      return {
        name: assertion.name,
        kind: assertion.kind,
        passed,
        actualDistance,
        minimum: assertion.min,
        maximum: assertion.max,
        references: [assertion.from, assertion.to],
        closestPoints: [from, to],
        detail: `Planar distance ${actualDistance.toFixed(2)}; required ` +
          `${assertion.min === undefined ? "no minimum" : `minimum ${assertion.min}`}, ` +
          `${assertion.max === undefined ? "no maximum" : `maximum ${assertion.max}`}.`,
      };
    }

    if (assertion.kind === "entityPathDistance") {
      const entity = entities.get(assertion.entity);
      const path = paths.get(assertion.path);
      if (!entity || !path) {
        const missing = [!entity ? assertion.entity : undefined, !path ? assertion.path : undefined].filter(Boolean).join(", ");
        return {
          name: assertion.name,
          kind: assertion.kind,
          passed: false,
          minimum: assertion.min,
          maximum: assertion.max,
          references: [assertion.entity, assertion.path],
          detail: `Missing managed entity/path reference(s): ${missing}.`,
        };
      }
      const witness = minimumPointPathDistanceWitness(entity, path);
      const actualDistance = witness.distance;
      const passed = (assertion.min === undefined || actualDistance >= assertion.min - 1e-6) &&
        (assertion.max === undefined || actualDistance <= assertion.max + 1e-6);
      return {
        name: assertion.name,
        kind: assertion.kind,
        passed,
        actualDistance,
        minimum: assertion.min,
        maximum: assertion.max,
        references: [assertion.entity, assertion.path],
        closestPoints: witness.points,
        detail: `Minimum planar entity-to-polyline distance ${actualDistance.toFixed(2)}; required ` +
          `${assertion.min === undefined ? "no minimum" : `minimum ${assertion.min}`}, ` +
          `${assertion.max === undefined ? "no maximum" : `maximum ${assertion.max}`}.`,
      };
    }

    const pathA = paths.get(assertion.pathA);
    const pathB = paths.get(assertion.pathB);
    if (!pathA || !pathB) {
      const missing = [!pathA ? assertion.pathA : undefined, !pathB ? assertion.pathB : undefined].filter(Boolean).join(", ");
      return {
        name: assertion.name,
        kind: assertion.kind,
        passed: false,
        minimum: assertion.min,
        references: [assertion.pathA, assertion.pathB],
        detail: `Missing managed path reference(s): ${missing}.`,
      };
    }
    const witness = minimumPathSeparationWitness(pathA, pathB);
    const actualDistance = witness.distance;
    return {
      name: assertion.name,
      kind: assertion.kind,
      passed: actualDistance >= assertion.min - 1e-6,
      actualDistance,
      minimum: assertion.min,
      references: [assertion.pathA, assertion.pathB],
      closestPoints: witness.points,
      detail: `Minimum planar polyline separation ${actualDistance.toFixed(2)}; required minimum ${assertion.min}.`,
    };
  });
}

/**
 * Evaluate a contract's declared rules using coordinates serialized in a converted VMAP.
 * The contract still defines path membership and limits; actual named entities supply every measured point.
 */
export function evaluateSpatialAssertionsAgainstMap(
  contract: MapContract,
  actualEntities: readonly ParsedMapEntity[],
): SpatialAssertionResult[] {
  const counts = new Map<string, number>();
  for (const entity of actualEntities) {
    if (entity.targetname) counts.set(entity.targetname, (counts.get(entity.targetname) ?? 0) + 1);
  }
  const unique = new Map<string, ParsedMapEntity>();
  for (const entity of actualEntities) {
    if (!entity.targetname || counts.get(entity.targetname) !== 1 || !vector3(entity.origin)) continue;
    unique.set(entity.targetname, entity);
  }
  const managedEntities: ManagedMapEntity[] = [...unique.values()].map((entity) => ({
    targetname: entity.targetname!,
    classname: entity.classname,
    origin: entity.origin!,
  }));
  const managedPaths: ManagedMapPath[] = [];
  for (const declared of contract.managedPaths ?? []) {
    const startIndex = declared.startIndex ?? 1;
    const points = declared.points.map((_, offset) => {
      const entity = unique.get(`${declared.name}_${startIndex + offset}`);
      return vector3(entity?.origin);
    });
    if (points.some((point) => !point)) continue;
    managedPaths.push({ ...declared, points: points as [number, number, number][] });
  }
  return evaluateSpatialAssertions({
    ...contract,
    managedEntities,
    managedPaths,
  });
}

export function assertSpatialAssertions(contract: MapContract, path = "map specification"): void {
  const failures = evaluateSpatialAssertions(contract).filter((result) => !result.passed);
  if (!failures.length) return;
  throw new Error(
    `Spatial assertion failure in ${path}: ` +
    failures.map((failure) => `${failure.name} (${failure.detail})`).join("; "),
  );
}

export function summarizeSpatialAssertions(results: readonly SpatialAssertionResult[]): SpatialAssertionSummary {
  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    unresolved: results.filter((result) => result.actualDistance === undefined).length,
  };
}
