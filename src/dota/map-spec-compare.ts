import { MapContract } from "./map-contract.js";

export interface MapSpecificationValueDifference {
  path: string;
  baseline: unknown;
  candidate: unknown;
  kind: "added" | "removed" | "changed";
}

export interface MapSpecificationChangedItem {
  key: string;
  fieldDifferenceCount: number;
  differences: MapSpecificationValueDifference[];
}

export interface MapSpecificationFamilyComparison {
  baselineCount: number;
  candidateCount: number;
  unchangedCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  added: string[];
  removed: string[];
  changed: MapSpecificationChangedItem[];
}

export interface ToleratedNumericDrift {
  path: string;
  baseline: number;
  candidate: number;
  delta: number;
}

export interface MapSpecificationComparisonReport {
  equivalent: boolean;
  exactEquivalent: boolean;
  numericTolerance: number;
  differenceCount: number;
  fieldDifferenceCount: number;
  toleratedNumericDriftCount: number;
  maximumToleratedNumericDrift: number;
  toleratedNumericDrift: ToleratedNumericDrift[];
  truncated: boolean;
  map: {
    baseline?: string;
    candidate?: string;
    equivalent: boolean;
  };
  families: {
    requiredEntities: MapSpecificationFamilyComparison;
    managedEntities: MapSpecificationFamilyComparison;
    managedAbsentEntities: MapSpecificationFamilyComparison;
    managedPaths: MapSpecificationFamilyComparison;
    managedTerrain: MapSpecificationFamilyComparison;
    managedSolids: MapSpecificationFamilyComparison;
    managedNavSurfaces: MapSpecificationFamilyComparison;
    managedVolumes: MapSpecificationFamilyComparison;
  };
}

export interface MapSpecificationComparisonOptions {
  numericTolerance?: number;
  maxDifferences?: number;
}

type JsonObject = Record<string, unknown>;

interface ComparisonContext {
  tolerance: number;
  maxDifferences: number;
  detailedDifferenceCount: number;
  fieldDifferenceCount: number;
  toleratedNumericDriftCount: number;
  maximumToleratedNumericDrift: number;
  toleratedNumericDrift: ToleratedNumericDrift[];
  truncated: boolean;
}

function normalizeVector(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const coordinates = value.trim().split(/\s+/).map(Number);
  return coordinates.length === 3 && coordinates.every(Number.isFinite) ? coordinates : value;
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeValue(entry)]),
  );
}

function normalizeEntity<T extends JsonObject>(entity: T): JsonObject {
  return normalizeValue({
    ...entity,
    origin: normalizeVector(entity.origin),
    angles: normalizeVector(entity.angles),
    scales: normalizeVector(entity.scales),
    absentProperties: Array.isArray(entity.absentProperties)
      ? [...entity.absentProperties].sort()
      : entity.absentProperties,
    removeProperties: Array.isArray(entity.removeProperties)
      ? [...entity.removeProperties].sort()
      : entity.removeProperties,
  }) as JsonObject;
}

function normalizePath(path: JsonObject): JsonObject {
  return normalizeValue({ ...path, angles: normalizeVector(path.angles) }) as JsonObject;
}

function normalizedStableString(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function recordDifference(
  context: ComparisonContext,
  differences: MapSpecificationValueDifference[],
  difference: MapSpecificationValueDifference,
): void {
  context.fieldDifferenceCount++;
  if (context.detailedDifferenceCount < context.maxDifferences) {
    differences.push(difference);
    context.detailedDifferenceCount++;
  } else {
    context.truncated = true;
  }
}

function compareValues(
  baseline: unknown,
  candidate: unknown,
  path: string,
  context: ComparisonContext,
  differences: MapSpecificationValueDifference[],
): number {
  const before = context.fieldDifferenceCount;
  if (typeof baseline === "number" && typeof candidate === "number") {
    if (Object.is(baseline, candidate)) return 0;
    const delta = Math.abs(candidate - baseline);
    if (delta <= context.tolerance) {
      context.toleratedNumericDriftCount++;
      context.maximumToleratedNumericDrift = Math.max(context.maximumToleratedNumericDrift, delta);
      if (context.toleratedNumericDrift.length < context.maxDifferences) {
        context.toleratedNumericDrift.push({
          path,
          baseline,
          candidate,
          delta: candidate - baseline,
        });
      } else {
        context.truncated = true;
      }
      return 0;
    }
    recordDifference(context, differences, { path, baseline, candidate, kind: "changed" });
    return context.fieldDifferenceCount - before;
  }
  if (Array.isArray(baseline) || Array.isArray(candidate)) {
    if (!Array.isArray(baseline) || !Array.isArray(candidate)) {
      recordDifference(context, differences, { path, baseline, candidate, kind: "changed" });
      return context.fieldDifferenceCount - before;
    }
    const shared = Math.min(baseline.length, candidate.length);
    for (let index = 0; index < shared; index++) {
      compareValues(baseline[index], candidate[index], `${path}[${index}]`, context, differences);
    }
    for (let index = shared; index < baseline.length; index++) {
      recordDifference(context, differences, {
        path: `${path}[${index}]`,
        baseline: baseline[index],
        candidate: undefined,
        kind: "removed",
      });
    }
    for (let index = shared; index < candidate.length; index++) {
      recordDifference(context, differences, {
        path: `${path}[${index}]`,
        baseline: undefined,
        candidate: candidate[index],
        kind: "added",
      });
    }
    return context.fieldDifferenceCount - before;
  }
  const baselineObject = baseline && typeof baseline === "object";
  const candidateObject = candidate && typeof candidate === "object";
  if (baselineObject || candidateObject) {
    if (!baselineObject || !candidateObject) {
      recordDifference(context, differences, { path, baseline, candidate, kind: "changed" });
      return context.fieldDifferenceCount - before;
    }
    const left = baseline as JsonObject;
    const right = candidate as JsonObject;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const hasLeft = Object.prototype.hasOwnProperty.call(left, key);
      const hasRight = Object.prototype.hasOwnProperty.call(right, key);
      const nextPath = childPath(path, key);
      if (!hasLeft) {
        recordDifference(context, differences, {
          path: nextPath,
          baseline: undefined,
          candidate: right[key],
          kind: "added",
        });
      } else if (!hasRight) {
        recordDifference(context, differences, {
          path: nextPath,
          baseline: left[key],
          candidate: undefined,
          kind: "removed",
        });
      } else {
        compareValues(left[key], right[key], nextPath, context, differences);
      }
    }
    return context.fieldDifferenceCount - before;
  }
  if (!Object.is(baseline, candidate)) {
    recordDifference(context, differences, { path, baseline, candidate, kind: "changed" });
  }
  return context.fieldDifferenceCount - before;
}

function keyedItems<T>(
  items: T[],
  key: (item: T, index: number) => string,
): Map<string, T> {
  return new Map(items.map((item, index) => [key(item, index), item]));
}

function compareFamily<T>(
  familyName: string,
  baselineItems: T[],
  candidateItems: T[],
  key: (item: T, index: number) => string,
  normalize: (item: T) => unknown,
  context: ComparisonContext,
): MapSpecificationFamilyComparison {
  const baseline = keyedItems(baselineItems, key);
  const candidate = keyedItems(candidateItems, key);
  const baselineKeys = [...baseline.keys()].sort();
  const candidateKeys = [...candidate.keys()].sort();
  const addedAll = candidateKeys.filter((name) => !baseline.has(name));
  const removedAll = baselineKeys.filter((name) => !candidate.has(name));
  const changed: MapSpecificationChangedItem[] = [];
  let unchangedCount = 0;
  for (const name of baselineKeys.filter((candidateName) => candidate.has(candidateName))) {
    const differences: MapSpecificationValueDifference[] = [];
    const count = compareValues(
      normalize(baseline.get(name)!),
      normalize(candidate.get(name)!),
      `${familyName}[${JSON.stringify(name)}]`,
      context,
      differences,
    );
    if (count === 0) {
      unchangedCount++;
    } else if (changed.length < context.maxDifferences) {
      changed.push({ key: name, fieldDifferenceCount: count, differences });
    } else {
      context.truncated = true;
    }
  }
  if (addedAll.length > context.maxDifferences || removedAll.length > context.maxDifferences) {
    context.truncated = true;
  }
  return {
    baselineCount: baselineItems.length,
    candidateCount: candidateItems.length,
    unchangedCount,
    addedCount: addedAll.length,
    removedCount: removedAll.length,
    changedCount: baselineKeys.filter((name) => candidate.has(name)).length - unchangedCount,
    added: addedAll.slice(0, context.maxDifferences),
    removed: removedAll.slice(0, context.maxDifferences),
    changed,
  };
}

function targetname(item: { targetname: string }): string {
  return item.targetname;
}

function pathName(item: { name: string }): string {
  return item.name;
}

function absentKey(item: JsonObject): string {
  return typeof item.targetname === "string"
    ? `targetname:${item.targetname}`
    : `selector:${normalizedStableString(normalizeEntity(item))}`;
}

function terrainKey(_item: unknown, index: number): string {
  return String(index).padStart(6, "0");
}

function familyDifferenceCount(family: MapSpecificationFamilyComparison): number {
  return family.addedCount + family.removedCount + family.changedCount;
}

/** Compare two fully expanded, validated map contracts without touching a VMAP. */
export function compareMapSpecifications(
  baseline: MapContract,
  candidate: MapContract,
  options: MapSpecificationComparisonOptions = {},
): MapSpecificationComparisonReport {
  const numericTolerance = options.numericTolerance ?? 0;
  const maxDifferences = options.maxDifferences ?? 100;
  if (!Number.isFinite(numericTolerance) || numericTolerance < 0 || numericTolerance > 1) {
    throw new Error("numericTolerance must be a finite number from 0 through 1");
  }
  if (!Number.isInteger(maxDifferences) || maxDifferences < 1 || maxDifferences > 1000) {
    throw new Error("maxDifferences must be an integer from 1 through 1000");
  }
  const context: ComparisonContext = {
    tolerance: numericTolerance,
    maxDifferences,
    detailedDifferenceCount: 0,
    fieldDifferenceCount: 0,
    toleratedNumericDriftCount: 0,
    maximumToleratedNumericDrift: 0,
    toleratedNumericDrift: [],
    truncated: false,
  };
  const mapDifferences: MapSpecificationValueDifference[] = [];
  const mapDifferenceCount = compareValues(
    baseline.map,
    candidate.map,
    "map",
    context,
    mapDifferences,
  );
  const families = {
    requiredEntities: compareFamily(
      "requiredEntities",
      baseline.requiredEntities,
      candidate.requiredEntities,
      targetname,
      (item) => normalizeEntity(item as unknown as JsonObject),
      context,
    ),
    managedEntities: compareFamily(
      "managedEntities",
      baseline.managedEntities ?? [],
      candidate.managedEntities ?? [],
      targetname,
      (item) => normalizeEntity(item as unknown as JsonObject),
      context,
    ),
    managedAbsentEntities: compareFamily(
      "managedAbsentEntities",
      baseline.managedAbsentEntities ?? [],
      candidate.managedAbsentEntities ?? [],
      (item) => absentKey(item as unknown as JsonObject),
      (item) => normalizeEntity(item as unknown as JsonObject),
      context,
    ),
    managedPaths: compareFamily(
      "managedPaths",
      baseline.managedPaths ?? [],
      candidate.managedPaths ?? [],
      pathName,
      (item) => normalizePath(item as unknown as JsonObject),
      context,
    ),
    managedTerrain: compareFamily(
      "managedTerrain",
      baseline.managedTerrain ?? [],
      candidate.managedTerrain ?? [],
      terrainKey,
      normalizeValue,
      context,
    ),
    managedSolids: compareFamily(
      "managedSolids",
      baseline.managedSolids ?? [],
      candidate.managedSolids ?? [],
      targetname,
      normalizeValue,
      context,
    ),
    managedNavSurfaces: compareFamily(
      "managedNavSurfaces",
      baseline.managedNavSurfaces ?? [],
      candidate.managedNavSurfaces ?? [],
      targetname,
      normalizeValue,
      context,
    ),
    managedVolumes: compareFamily(
      "managedVolumes",
      baseline.managedVolumes ?? [],
      candidate.managedVolumes ?? [],
      targetname,
      normalizeValue,
      context,
    ),
  };
  const differenceCount = mapDifferenceCount + Object.values(families)
    .reduce((sum, family) => sum + familyDifferenceCount(family), 0);
  const equivalent = differenceCount === 0;
  return {
    equivalent,
    exactEquivalent: equivalent && context.toleratedNumericDriftCount === 0,
    numericTolerance,
    differenceCount,
    fieldDifferenceCount: context.fieldDifferenceCount,
    toleratedNumericDriftCount: context.toleratedNumericDriftCount,
    maximumToleratedNumericDrift: context.maximumToleratedNumericDrift,
    toleratedNumericDrift: context.toleratedNumericDrift,
    truncated: context.truncated,
    map: {
      baseline: baseline.map,
      candidate: candidate.map,
      equivalent: mapDifferenceCount === 0,
    },
    families,
  };
}
