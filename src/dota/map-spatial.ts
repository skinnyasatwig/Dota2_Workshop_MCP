import { z } from "zod";
import type { ManagedMapEntity, ManagedMapPath, MapContract } from "./map-contract.js";

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
  detail: string;
}

type Point2 = [number, number];

function parseOrigin(entity: ManagedMapEntity): Point2 | undefined {
  const values = entity.origin.trim().split(/\s+/).map(Number);
  return values.length === 3 && values.every(Number.isFinite) ? [values[0], values[1]] : undefined;
}

function pointSegmentDistance(point: Point2, from: Point2, to: Point2): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - from[0], point[1] - from[1]);
  const amount = Math.max(0, Math.min(1,
    ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (from[0] + dx * amount), point[1] - (from[1] + dy * amount));
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

function segmentDistance(a0: Point2, a1: Point2, b0: Point2, b1: Point2): number {
  if (segmentsIntersect(a0, a1, b0, b1)) return 0;
  return Math.min(
    pointSegmentDistance(a0, b0, b1),
    pointSegmentDistance(a1, b0, b1),
    pointSegmentDistance(b0, a0, a1),
    pointSegmentDistance(b1, a0, a1),
  );
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
  let minimum = Number.POSITIVE_INFINITY;
  for (const [a0, a1] of pathSegments(a)) {
    for (const [b0, b1] of pathSegments(b)) {
      minimum = Math.min(minimum, segmentDistance(a0, a1, b0, b1));
    }
  }
  return minimum;
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
    if (assertion.kind === "entityDistance") {
      if (assertion.from === assertion.to) {
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
        detail: `Planar distance ${actualDistance.toFixed(2)}; required ` +
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
    const actualDistance = minimumPathSeparation(pathA, pathB);
    return {
      name: assertion.name,
      kind: assertion.kind,
      passed: actualDistance >= assertion.min - 1e-6,
      actualDistance,
      minimum: assertion.min,
      references: [assertion.pathA, assertion.pathB],
      detail: `Minimum planar polyline separation ${actualDistance.toFixed(2)}; required minimum ${assertion.min}.`,
    };
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
