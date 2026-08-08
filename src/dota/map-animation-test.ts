import { parseMapEntities } from "./vmap.js";

const TARGET_NAME_RE = /^[A-Za-z0-9_.:-]+$/;
const MODEL_RE = /^models\/[A-Za-z0-9_./-]+\.vmdl$/i;
const SEQUENCE_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export interface MapAnimationTargetInspection {
  targetName: string;
  foundCount: number;
  classname?: string;
  model?: string;
  sequence?: string;
  origin?: string;
  angles?: string;
  scales?: string;
  animateOnServer?: boolean;
  clientSafe?: boolean;
  issues: string[];
  passed: boolean;
}

/**
 * Resolve one exact VMAP entity into the runtime identity expected by a
 * correlated animation test. Ambiguity and changing start/idle sequences fail
 * closed so the live test never guesses what should be playing.
 */
export function inspectMapAnimationTarget(
  mapText: string,
  targetName: string,
): MapAnimationTargetInspection {
  const issues: string[] = [];
  if (!TARGET_NAME_RE.test(targetName)) {
    return {
      targetName,
      foundCount: 0,
      issues: ["Animation targetname may contain only letters, digits, _, ., :, and -."],
      passed: false,
    };
  }
  const matches = parseMapEntities(mapText).filter((entity) => entity.targetname === targetName);
  if (matches.length !== 1) {
    return {
      targetName,
      foundCount: matches.length,
      issues: [matches.length === 0
        ? `Animation target ${targetName} was not found in the source VMAP.`
        : `Animation target ${targetName} is ambiguous (${matches.length} entities).`],
      passed: false,
    };
  }

  const entity = matches[0];
  const model = entity.properties.model;
  const starting = entity.properties.StartingAnim;
  const idle = entity.properties.IdleAnim;
  if (entity.classname !== "prop_dynamic") {
    issues.push(`${targetName} is ${entity.classname}; deterministic animation verification currently requires prop_dynamic.`);
  }
  if (!model || !MODEL_RE.test(model) || model.split("/").includes("..")) {
    issues.push(`${targetName} has no safe models/*.vmdl resource.`);
  }
  if (!starting || !SEQUENCE_RE.test(starting)) {
    issues.push(`${targetName} has no safe StartingAnim sequence.`);
  }
  if (!idle || !SEQUENCE_RE.test(idle)) {
    issues.push(`${targetName} has no safe IdleAnim sequence.`);
  }
  if (starting && idle && starting !== idle) {
    issues.push(`${targetName} changes from StartingAnim ${starting} to IdleAnim ${idle}; the expected live sequence is ambiguous.`);
  }
  const clientSafe = entity.properties.solid === "0" &&
    entity.properties.CreateNavObstacle === "0" &&
    entity.properties.use_animgraph === "0";
  if (!clientSafe) {
    issues.push(`${targetName} is not explicitly non-solid, navigation-neutral, and animgraph-disabled.`);
  }
  const animateOnServer = entity.properties.AnimateOnServer === "1";
  return {
    targetName,
    foundCount: 1,
    classname: entity.classname,
    model,
    sequence: starting,
    origin: entity.origin,
    angles: entity.angles,
    scales: entity.scales,
    animateOnServer,
    clientSafe,
    issues,
    passed: issues.length === 0,
  };
}
