import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathExists } from "../util/fsx.js";

export interface MapEntityRequirement {
  targetname: string;
  classname?: string;
  origin?: string;
  angles?: string;
  properties?: Record<string, string>;
  absentProperties?: string[];
}

export interface ManagedMapEntity {
  targetname: string;
  classname: string;
  origin: string;
  angles?: string;
  properties?: Record<string, string>;
  removeProperties?: string[];
}

export interface ManagedMapPath {
  name: string;
  points: [number, number, number][];
  classname?: string;
  startIndex?: number;
  loop?: boolean;
  angles?: string;
  properties?: Record<string, string>;
  maxSegmentLength?: number;
  mirrorOf?: string;
  mirrorAxis?: "x" | "y" | "xy";
}

export interface MapContract {
  map?: string;
  requiredEntities: MapEntityRequirement[];
  managedEntities?: ManagedMapEntity[];
  managedPaths?: ManagedMapPath[];
}

export interface ResolvedMapContract {
  path: string;
  contract: MapContract;
}

function scalarProperties(value: unknown, field: string, path: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object: ${path}`);
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, property]) => {
      if (!["string", "number", "boolean"].includes(typeof property)) {
        throw new Error(`${field}.${key} must be a scalar: ${path}`);
      }
      return [key, String(property)];
    }),
  );
}

export function expandManagedPath(path: ManagedMapPath): ManagedMapEntity[] {
  const startIndex = path.startIndex ?? 1;
  return path.points.map((point, offset) => {
    const index = startIndex + offset;
    const isLast = offset === path.points.length - 1;
    const properties = { ...(path.properties ?? {}) };
    if (!isLast) properties.target = `${path.name}_${index + 1}`;
    else if (path.loop) properties.target = `${path.name}_${startIndex}`;
    return {
      targetname: `${path.name}_${index}`,
      classname: path.classname ?? "path_corner",
      origin: point.join(" "),
      angles: path.angles,
      properties: Object.keys(properties).length ? properties : undefined,
      removeProperties: isLast && !path.loop ? ["target"] : undefined,
    };
  });
}

export function managedEntitiesForContract(contract: MapContract): ManagedMapEntity[] {
  return [
    ...(contract.managedEntities ?? []),
    ...(contract.managedPaths ?? []).flatMap(expandManagedPath),
  ];
}

function validateContract(value: unknown, path: string): MapContract {
  if (!value || typeof value !== "object") throw new Error(`Map contract must be a JSON object: ${path}`);
  const raw = value as Record<string, unknown>;
  if (raw.map !== undefined && typeof raw.map !== "string") throw new Error(`Map contract "map" must be a string: ${path}`);
  if (!Array.isArray(raw.requiredEntities)) throw new Error(`Map contract requires a requiredEntities array: ${path}`);
  const requiredEntities = raw.requiredEntities.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`requiredEntities[${index}] must be an object: ${path}`);
    const requirement = entry as Record<string, unknown>;
    if (typeof requirement.targetname !== "string" || !requirement.targetname) {
      throw new Error(`requiredEntities[${index}].targetname must be a non-empty string: ${path}`);
    }
    if (requirement.classname !== undefined && typeof requirement.classname !== "string") {
      throw new Error(`requiredEntities[${index}].classname must be a string: ${path}`);
    }
    for (const key of ["origin", "angles"]) {
      if (requirement[key] !== undefined && typeof requirement[key] !== "string") {
        throw new Error(`requiredEntities[${index}].${key} must be a string: ${path}`);
      }
    }
    const properties = scalarProperties(
      requirement.properties,
      `requiredEntities[${index}].properties`,
      path,
    );
    let absentProperties: string[] | undefined;
    if (requirement.absentProperties !== undefined) {
      if (
        !Array.isArray(requirement.absentProperties) ||
        !requirement.absentProperties.every((key) => typeof key === "string" && key)
      ) {
        throw new Error(`requiredEntities[${index}].absentProperties must be an array of strings: ${path}`);
      }
      absentProperties = [...new Set(requirement.absentProperties as string[])];
      const conflict = absentProperties.find((key) => properties?.[key] !== undefined);
      if (conflict) {
        throw new Error(`requiredEntities[${index}] both requires and forbids property "${conflict}": ${path}`);
      }
    }
    return {
      targetname: requirement.targetname,
      classname: requirement.classname as string | undefined,
      origin: requirement.origin as string | undefined,
      angles: requirement.angles as string | undefined,
      properties,
      absentProperties,
    };
  });
  let managedEntities: ManagedMapEntity[] | undefined;
  if (raw.managedEntities !== undefined) {
    if (!Array.isArray(raw.managedEntities)) {
      throw new Error(`Map contract "managedEntities" must be an array: ${path}`);
    }
    managedEntities = raw.managedEntities.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`managedEntities[${index}] must be an object: ${path}`);
      }
      const managed = entry as Record<string, unknown>;
      for (const key of ["targetname", "classname", "origin"]) {
        if (typeof managed[key] !== "string" || !managed[key]) {
          throw new Error(`managedEntities[${index}].${key} must be a non-empty string: ${path}`);
        }
      }
      if (managed.angles !== undefined && typeof managed.angles !== "string") {
        throw new Error(`managedEntities[${index}].angles must be a string: ${path}`);
      }
      let removeProperties: string[] | undefined;
      if (managed.removeProperties !== undefined) {
        if (
          !Array.isArray(managed.removeProperties) ||
          !managed.removeProperties.every((key) => typeof key === "string" && key)
        ) {
          throw new Error(`managedEntities[${index}].removeProperties must be an array of strings: ${path}`);
        }
        removeProperties = [...new Set(managed.removeProperties as string[])];
      }
      const properties = scalarProperties(
        managed.properties,
        `managedEntities[${index}].properties`,
        path,
      );
      const conflict = removeProperties?.find((key) => properties?.[key] !== undefined);
      if (conflict) {
        throw new Error(`managedEntities[${index}] both sets and removes property "${conflict}": ${path}`);
      }
      return {
        targetname: managed.targetname as string,
        classname: managed.classname as string,
        origin: managed.origin as string,
        angles: managed.angles as string | undefined,
        properties,
        removeProperties,
      };
    });
  }
  let managedPaths: ManagedMapPath[] | undefined;
  if (raw.managedPaths !== undefined) {
    if (!Array.isArray(raw.managedPaths)) {
      throw new Error(`Map contract "managedPaths" must be an array: ${path}`);
    }
    managedPaths = raw.managedPaths.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`managedPaths[${index}] must be an object: ${path}`);
      }
      const managedPath = entry as Record<string, unknown>;
      if (typeof managedPath.name !== "string" || !managedPath.name) {
        throw new Error(`managedPaths[${index}].name must be a non-empty string: ${path}`);
      }
      if (!Array.isArray(managedPath.points) || !managedPath.points.length) {
        throw new Error(`managedPaths[${index}].points must be a non-empty array: ${path}`);
      }
      const points = managedPath.points.map((point, pointIndex) => {
        if (
          !Array.isArray(point) ||
          point.length !== 3 ||
          !point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
        ) {
          throw new Error(`managedPaths[${index}].points[${pointIndex}] must be [x, y, z] numbers: ${path}`);
        }
        return point as [number, number, number];
      });
      if (managedPath.classname !== undefined && (typeof managedPath.classname !== "string" || !managedPath.classname)) {
        throw new Error(`managedPaths[${index}].classname must be a non-empty string: ${path}`);
      }
      if (
        managedPath.startIndex !== undefined &&
        (!Number.isInteger(managedPath.startIndex) || (managedPath.startIndex as number) < 0)
      ) {
        throw new Error(`managedPaths[${index}].startIndex must be a non-negative integer: ${path}`);
      }
      if (managedPath.loop !== undefined && typeof managedPath.loop !== "boolean") {
        throw new Error(`managedPaths[${index}].loop must be a boolean: ${path}`);
      }
      if (managedPath.angles !== undefined && typeof managedPath.angles !== "string") {
        throw new Error(`managedPaths[${index}].angles must be a string: ${path}`);
      }
      if (
        managedPath.maxSegmentLength !== undefined &&
        (
          typeof managedPath.maxSegmentLength !== "number" ||
          !Number.isFinite(managedPath.maxSegmentLength) ||
          managedPath.maxSegmentLength <= 0
        )
      ) {
        throw new Error(`managedPaths[${index}].maxSegmentLength must be a positive number: ${path}`);
      }
      const maxSegmentLength = managedPath.maxSegmentLength as number | undefined;
      if (managedPath.mirrorOf !== undefined && (typeof managedPath.mirrorOf !== "string" || !managedPath.mirrorOf)) {
        throw new Error(`managedPaths[${index}].mirrorOf must be a non-empty string: ${path}`);
      }
      if (
        managedPath.mirrorAxis !== undefined &&
        !["x", "y", "xy"].includes(managedPath.mirrorAxis as string)
      ) {
        throw new Error(`managedPaths[${index}].mirrorAxis must be x, y, or xy: ${path}`);
      }
      if ((managedPath.mirrorOf === undefined) !== (managedPath.mirrorAxis === undefined)) {
        throw new Error(`managedPaths[${index}] must set mirrorOf and mirrorAxis together: ${path}`);
      }
      for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
        const previous = points[pointIndex - 1];
        const current = points[pointIndex];
        const distance = Math.hypot(
          current[0] - previous[0],
          current[1] - previous[1],
          current[2] - previous[2],
        );
        if (distance === 0) {
          throw new Error(`managedPaths[${index}] repeats point ${pointIndex}: ${path}`);
        }
        if (
          maxSegmentLength !== undefined &&
          distance > maxSegmentLength
        ) {
          throw new Error(
            `managedPaths[${index}] segment ${pointIndex} length ${distance.toFixed(2)} exceeds ` +
              `maxSegmentLength ${maxSegmentLength}: ${path}`,
          );
        }
      }
      const properties = scalarProperties(
        managedPath.properties,
        `managedPaths[${index}].properties`,
        path,
      );
      if (properties?.target !== undefined || properties?.targetname !== undefined) {
        throw new Error(
          `managedPaths[${index}].properties cannot set target or targetname; links are generated: ${path}`,
        );
      }
      return {
        name: managedPath.name,
        points,
        classname: managedPath.classname as string | undefined,
        startIndex: managedPath.startIndex as number | undefined,
        loop: managedPath.loop as boolean | undefined,
        angles: managedPath.angles as string | undefined,
        properties,
        maxSegmentLength,
        mirrorOf: managedPath.mirrorOf as string | undefined,
        mirrorAxis: managedPath.mirrorAxis as "x" | "y" | "xy" | undefined,
      };
    });
    const pathsByName = new Map<string, ManagedMapPath>();
    for (const managedPath of managedPaths) {
      if (pathsByName.has(managedPath.name)) {
        throw new Error(`managedPaths contains duplicate name "${managedPath.name}": ${path}`);
      }
      pathsByName.set(managedPath.name, managedPath);
    }
    for (const managedPath of managedPaths) {
      if (!managedPath.mirrorOf || !managedPath.mirrorAxis) continue;
      const reference = pathsByName.get(managedPath.mirrorOf);
      if (!reference) {
        throw new Error(
          `managedPath "${managedPath.name}" mirrors missing path "${managedPath.mirrorOf}": ${path}`,
        );
      }
      if (reference.points.length !== managedPath.points.length) {
        throw new Error(
          `managedPath "${managedPath.name}" must have ${reference.points.length} points to mirror ` +
            `"${managedPath.mirrorOf}": ${path}`,
        );
      }
      for (let pointIndex = 0; pointIndex < reference.points.length; pointIndex++) {
        const [x, y, z] = reference.points[pointIndex];
        const expected: [number, number, number] = [
          managedPath.mirrorAxis.includes("x") ? -x : x,
          managedPath.mirrorAxis.includes("y") ? -y : y,
          z,
        ];
        const actual = managedPath.points[pointIndex];
        if (!actual.every((coordinate, axis) => coordinate === expected[axis])) {
          throw new Error(
            `managedPath "${managedPath.name}" point ${pointIndex} is not the ${managedPath.mirrorAxis}-axis ` +
              `mirror of "${managedPath.mirrorOf}": ${path}`,
          );
        }
      }
    }
  }
  const contract = {
    map: raw.map as string | undefined,
    requiredEntities,
    managedEntities,
    managedPaths,
  };
  const names = new Set<string>();
  for (const managed of managedEntitiesForContract(contract)) {
    if (names.has(managed.targetname)) {
      throw new Error(`Managed contract contains duplicate targetname "${managed.targetname}": ${path}`);
    }
    names.add(managed.targetname);
  }
  return contract;
}

export async function loadMapContract(
  projectRoot: string,
  map: string,
  contractFile?: string,
): Promise<ResolvedMapContract | undefined> {
  const path = contractFile
    ? isAbsolute(contractFile)
      ? contractFile
      : join(projectRoot, contractFile)
    : join(projectRoot, ".dota-workshop", "map-contract.json");
  if (!(await pathExists(path))) {
    if (contractFile) throw new Error(`Map contract not found: ${path}`);
    return undefined;
  }
  const contract = validateContract(JSON.parse(await readFile(path, "utf8")), path);
  if (contract.map && contract.map !== map) {
    throw new Error(`Map contract ${path} is for "${contract.map}", not "${map}".`);
  }
  return { path, contract };
}
