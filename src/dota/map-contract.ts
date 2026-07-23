import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathExists } from "../util/fsx.js";

export interface MapEntityRequirement {
  targetname: string;
  classname?: string;
}

export interface MapContract {
  map?: string;
  requiredEntities: MapEntityRequirement[];
}

export interface ResolvedMapContract {
  path: string;
  contract: MapContract;
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
    return {
      targetname: requirement.targetname,
      classname: requirement.classname as string | undefined,
    };
  });
  return { map: raw.map as string | undefined, requiredEntities };
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
