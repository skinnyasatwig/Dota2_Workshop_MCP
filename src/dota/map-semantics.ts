import { ParsedMapEntity } from "./vmap.js";

export interface DotaMapSemanticFinding {
  severity: "error";
  code:
    | "fort-team-invalid"
    | "fort-unit-name-mismatch"
    | "building-team-unit-mismatch"
    | "neutral-spawner-volume-missing"
    | "neutral-spawner-volume-target-missing";
  targetname: string;
  message: string;
}

function entityLabel(entity: ParsedMapEntity): string {
  return entity.targetname ? `"${entity.targetname}"` : `unnamed ${entity.classname}`;
}

/**
 * Validate stock Dota building properties that resourcecompiler accepts but
 * server.dll expects to be internally consistent when the game enters pregame.
 */
export function validateDotaBuildingEntities(
  entities: ParsedMapEntity[],
): DotaMapSemanticFinding[] {
  const findings: DotaMapSemanticFinding[] = [];

  for (const entity of entities) {
    if (!["npc_dota_fort", "npc_dota_tower"].includes(entity.classname)) continue;

    const team = entity.properties.teamnumber;
    const unitName = entity.properties.MapUnitName;
    const label = entityLabel(entity);

    if (entity.classname === "npc_dota_fort") {
      if (team !== "2" && team !== "3") {
        findings.push({
          severity: "error",
          code: "fort-team-invalid",
          targetname: entity.targetname ?? "",
          message: `${label} must have teamnumber 2 (Radiant) or 3 (Dire); found ${team ?? "no value"}.`,
        });
        continue;
      }

      const expected = team === "2" ? "npc_dota_goodguys_fort" : "npc_dota_badguys_fort";
      if (unitName !== expected) {
        findings.push({
          severity: "error",
          code: "fort-unit-name-mismatch",
          targetname: entity.targetname ?? "",
          message:
            `${label} must have MapUnitName="${expected}" for team ${team}; ` +
            `found ${unitName ? `"${unitName}"` : "no MapUnitName"}.`,
        });
      }
      continue;
    }

    if (
      (team === "2" && unitName?.startsWith("npc_dota_badguys_")) ||
      (team === "3" && unitName?.startsWith("npc_dota_goodguys_"))
    ) {
      findings.push({
        severity: "error",
        code: "building-team-unit-mismatch",
        targetname: entity.targetname ?? "",
        message: `${label} assigns ${unitName} to team ${team}.`,
      });
    }
  }

  return findings;
}

/**
 * A native neutral spawner needs a named camp volume so Dota can determine
 * whether the camp is blocked or occupied. A bare point spawner is not a safe
 * blockout marker; use info_target until the volume exists.
 */
export function validateDotaNeutralSpawners(
  entities: ParsedMapEntity[],
): DotaMapSemanticFinding[] {
  const findings: DotaMapSemanticFinding[] = [];
  const targetnames = new Set(entities.map((entity) => entity.targetname).filter(Boolean));

  for (const entity of entities) {
    if (entity.classname !== "npc_dota_neutral_spawner") continue;
    const volumeName = entity.properties.VolumeName;
    const label = entityLabel(entity);
    if (!volumeName) {
      findings.push({
        severity: "error",
        code: "neutral-spawner-volume-missing",
        targetname: entity.targetname ?? "",
        message:
          `${label} has no VolumeName. Add a named neutral-camp boundary volume, ` +
          `or use info_target while roughing out the camp.`,
      });
    } else if (!targetnames.has(volumeName)) {
      findings.push({
        severity: "error",
        code: "neutral-spawner-volume-target-missing",
        targetname: entity.targetname ?? "",
        message: `${label} refers to missing camp volume "${volumeName}".`,
      });
    }
  }

  return findings;
}
