import { join } from "node:path";
import { AddonProject } from "./project.js";
import { DotaPaths } from "./paths.js";
import { ManagedMapEntity, MapContract, managedEntitiesForContract } from "./map-contract.js";
import {
  MapCollisionResolutionOptions,
  ModelPhysicsInspector,
  resolveMapCollisionObstacles,
} from "./map-collision.js";
import { ParsedMapEntity, parseMapEntities } from "./vmap.js";

export type ManagedModelPhysicsFindingCode =
  | "managed-model-physics-entity-missing"
  | "managed-model-physics-entity-duplicate"
  | "managed-model-physics-class-mismatch"
  | "managed-model-physics-model-mismatch"
  | "managed-model-physics-solid-mismatch"
  | "managed-model-physics-unresolved";

export interface ManagedModelPhysicsFinding {
  severity: "error";
  code: ManagedModelPhysicsFindingCode;
  targetname: string;
  model?: string;
  detail: string;
}

export interface ManagedModelPhysicsResolution {
  targetname: string;
  model: string;
  state: "resolved" | "invalid" | "unresolved";
  detail: string;
}

export interface ManagedModelPhysicsReport {
  requirementCount: number;
  resolvedCount: number;
  invalidCount: number;
  unresolvedCount: number;
  safeToWrite: boolean;
  models: ManagedModelPhysicsResolution[];
  findings: ManagedModelPhysicsFinding[];
}

function requiredPhysicsEntities(contract: MapContract): ManagedMapEntity[] {
  return managedEntitiesForContract(contract).filter((entity) => entity.modelPhysics === "required");
}

function entityModel(entity: ParsedMapEntity): string | undefined {
  return entity.properties.model ?? entity.properties.Model ?? entity.properties.modelname;
}

/**
 * Prove every explicit managed PHYS promise against the current VMAP and compiled model data.
 * Unmanaged legacy props are intentionally ignored so adopting the contract is incremental.
 */
export async function inspectManagedModelPhysics(
  entities: readonly ParsedMapEntity[],
  contract: MapContract,
  vpk: string,
  inspect?: ModelPhysicsInspector,
  options: MapCollisionResolutionOptions = {},
): Promise<ManagedModelPhysicsReport> {
  const requirements = requiredPhysicsEntities(contract);
  const findings: ManagedModelPhysicsFinding[] = [];
  const models: ManagedModelPhysicsResolution[] = [];
  const candidates: ParsedMapEntity[] = [];
  const candidateRequirements: ManagedMapEntity[] = [];

  for (const requirement of requirements) {
    const expectedModel = requirement.properties!.model!;
    const matches = entities.filter((entity) => entity.targetname === requirement.targetname);
    const invalid = (code: ManagedModelPhysicsFindingCode, detail: string) => {
      findings.push({
        severity: "error",
        code,
        targetname: requirement.targetname,
        model: expectedModel,
        detail,
      });
      models.push({ targetname: requirement.targetname, model: expectedModel, state: "invalid", detail });
    };
    if (!matches.length) {
      invalid(
        "managed-model-physics-entity-missing",
        `Managed collision prop "${requirement.targetname}" is missing from the VMAP.`,
      );
      continue;
    }
    if (matches.length !== 1) {
      invalid(
        "managed-model-physics-entity-duplicate",
        `Managed collision prop "${requirement.targetname}" appears ${matches.length} times.`,
      );
      continue;
    }
    const current = matches[0];
    if (current.classname !== "prop_static") {
      invalid(
        "managed-model-physics-class-mismatch",
        `Managed collision prop "${requirement.targetname}" is ${current.classname}, not prop_static.`,
      );
      continue;
    }
    const currentModel = entityModel(current);
    if (!currentModel || currentModel.toLowerCase() !== expectedModel.toLowerCase()) {
      invalid(
        "managed-model-physics-model-mismatch",
        `Managed collision prop "${requirement.targetname}" uses ` +
          `${currentModel ?? "no model"}, not ${expectedModel}.`,
      );
      continue;
    }
    if (current.properties.solid !== "6") {
      invalid(
        "managed-model-physics-solid-mismatch",
        `Managed collision prop "${requirement.targetname}" must serialize solid "6".`,
      );
      continue;
    }
    candidates.push(current);
    candidateRequirements.push(requirement);
  }

  const obstacles = candidates.length
    ? await resolveMapCollisionObstacles(candidates, vpk, inspect, options)
    : [];
  const obstaclesByTargetname = new Map(
    obstacles
      .filter((obstacle) => obstacle.targetname)
      .map((obstacle) => [obstacle.targetname!, obstacle]),
  );
  for (const requirement of candidateRequirements) {
    const expectedModel = requirement.properties!.model!;
    const obstacle = obstaclesByTargetname.get(requirement.targetname);
    if (obstacle?.confidence === "physical-model-bounds" && obstacle.physicalFootprints?.length) {
      models.push({
        targetname: requirement.targetname,
        model: expectedModel,
        state: "resolved",
        detail: obstacle.reason,
      });
      continue;
    }
    const detail = obstacle?.reason ??
      `Managed collision prop "${requirement.targetname}" did not produce a collision obstacle.`;
    findings.push({
      severity: "error",
      code: "managed-model-physics-unresolved",
      targetname: requirement.targetname,
      model: expectedModel,
      detail,
    });
    models.push({ targetname: requirement.targetname, model: expectedModel, state: "unresolved", detail });
  }

  models.sort((left, right) => left.targetname.localeCompare(right.targetname));
  return {
    requirementCount: requirements.length,
    resolvedCount: models.filter((model) => model.state === "resolved").length,
    invalidCount: models.filter((model) => model.state === "invalid").length,
    unresolvedCount: models.filter((model) => model.state === "unresolved").length,
    safeToWrite: findings.length === 0,
    models,
    findings,
  };
}

/** Resolve explicit managed PHYS promises using the active addon before base Dota assets. */
export async function inspectProjectManagedModelPhysics(
  mapText: string,
  dota: DotaPaths,
  project: AddonProject,
  contract: MapContract,
): Promise<ManagedModelPhysicsReport> {
  return inspectManagedModelPhysics(
    parseMapEntities(mapText),
    contract,
    dota.pak01DirVpk,
    undefined,
    {
      compiledModelRoots: [project.gameDir],
      compiledModelVpks: [join(project.gameDir, "pak01_dir.vpk")],
    },
  );
}
