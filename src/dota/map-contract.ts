import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathExists } from "../util/fsx.js";

export interface MapEntityRequirement {
  targetname: string;
  classname?: string;
  origin?: string;
  angles?: string;
  properties?: Record<string, string>;
}

export interface ManagedMapEntity {
  targetname: string;
  classname: string;
  origin: string;
  angles?: string;
  properties?: Record<string, string>;
}

export interface MapContract {
  map?: string;
  requiredEntities: MapEntityRequirement[];
  managedEntities?: ManagedMapEntity[];
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
    return {
      targetname: requirement.targetname,
      classname: requirement.classname as string | undefined,
      origin: requirement.origin as string | undefined,
      angles: requirement.angles as string | undefined,
      properties,
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
      return {
        targetname: managed.targetname as string,
        classname: managed.classname as string,
        origin: managed.origin as string,
        angles: managed.angles as string | undefined,
        properties: scalarProperties(
          managed.properties,
          `managedEntities[${index}].properties`,
          path,
        ),
      };
    });
    const names = new Set<string>();
    for (const managed of managedEntities) {
      if (names.has(managed.targetname)) {
        throw new Error(`managedEntities contains duplicate targetname "${managed.targetname}": ${path}`);
      }
      names.add(managed.targetname);
    }
  }
  return { map: raw.map as string | undefined, requiredEntities, managedEntities };
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
