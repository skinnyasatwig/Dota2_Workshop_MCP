import { StaticPropScale } from "./static-prop-palettes.js";

export const ANIMATED_PROP_RECIPE_IDS = [
  "radiant-team-banner",
  "dire-team-banner",
] as const;

export type AnimatedPropRecipeId = typeof ANIMATED_PROP_RECIPE_IDS[number];

export interface AnimatedPropSequence {
  label: string;
  looping: true;
}

export interface AnimatedPropRecipe {
  id: AnimatedPropRecipeId;
  label: string;
  intendedUse: string;
  model: string;
  defaultScale: StaticPropScale;
  /** Installed pak01 entry used when animation names and visual bounds were inspected. */
  compiledCrc: number;
  /** Valve MDAT scene-object bounds. Preview evidence only, never gameplay collision. */
  visualBounds: { min: [number, number, number]; max: [number, number, number] };
  defaultSequence: string;
  sequences: Readonly<Record<string, AnimatedPropSequence>>;
  collision: "none";
  createNavObstacle: false;
  useAnimGraph: false;
  animateOnServer: false;
  source: string;
}

const recipe = (
  id: AnimatedPropRecipeId,
  label: string,
  intendedUse: string,
  model: string,
  compiledCrc: number,
  min: [number, number, number],
  max: [number, number, number],
  defaultSequence: string,
  sequences: Readonly<Record<string, AnimatedPropSequence>>,
): AnimatedPropRecipe => ({
  id,
  label,
  intendedUse,
  model,
  defaultScale: 1,
  compiledCrc,
  visualBounds: { min, max },
  defaultSequence,
  sequences,
  collision: "none",
  createNavObstacle: false,
  useAnimGraph: false,
  animateOnServer: false,
  source:
    "Valve base.fgd and dota.fgd prop_dynamic definitions; installed pak01 ANIM sequence metadata; repository compiler fixture",
});

/**
 * Intentionally tiny first animated-prop library. Each recipe fixes the model and limits animation names to looping
 * sequences read from that exact compiled Valve resource. The CRC gates both the sequence snapshot and render bounds.
 */
export const ANIMATED_PROP_RECIPES: Readonly<Record<AnimatedPropRecipeId, AnimatedPropRecipe>> = {
  "radiant-team-banner": recipe(
    "radiant-team-banner",
    "Radiant team banner",
    "Non-solid animated Radiant base, gate, or objective dressing.",
    "models/props_teams/banner_radiant.vmdl",
    1446545301,
    [-7.14106, -64.000053, -105.571152],
    [13.593687, 63.999931, 352.428802],
    "banner_radiant_idle",
    {
      banner_radiant_idle: { label: "Idle", looping: true },
      banner_radiant_idle2: { label: "Alternate idle", looping: true },
    },
  ),
  "dire-team-banner": recipe(
    "dire-team-banner",
    "Dire team banner",
    "Non-solid animated Dire base, gate, or objective dressing.",
    "models/props_teams/banner_dire.vmdl",
    825093256,
    [-40.375847, -143.46788, -7.005608],
    [52.135391, 91.528908, 536.785522],
    "banner_dire_idle",
    {
      banner_dire_idle: { label: "Idle", looping: true },
      banner_dire_idle2: { label: "Alternate idle", looping: true },
    },
  ),
};

export function animatedPropRecipe(
  recipeId: AnimatedPropRecipeId,
): AnimatedPropRecipe {
  return ANIMATED_PROP_RECIPES[recipeId];
}

export function animatedPropSequence(
  recipeId: AnimatedPropRecipeId,
  sequence: string,
): AnimatedPropSequence | undefined {
  return ANIMATED_PROP_RECIPES[recipeId].sequences[sequence];
}

function scaleIsSafe(scale: StaticPropScale): boolean {
  const values: readonly number[] = typeof scale === "number" ? [scale] : scale;
  return values.every((value) => Number.isFinite(value) && value >= 0.01 && value <= 16);
}

export function validateAnimatedPropRecipeLibrary(): string[] {
  const errors: string[] = [];
  const models = new Set<string>();
  for (const id of ANIMATED_PROP_RECIPE_IDS) {
    const entry = ANIMATED_PROP_RECIPES[id];
    if (entry.id !== id) errors.push(`${id} has mismatched embedded id ${entry.id}.`);
    if (!/^models\/[A-Za-z0-9_./-]+\.vmdl$/i.test(entry.model) || entry.model.split("/").includes("..")) {
      errors.push(`${id} has an unsafe model path ${entry.model}.`);
    }
    const modelKey = entry.model.toLowerCase();
    if (models.has(modelKey)) errors.push(`${id} duplicates model ${entry.model}.`);
    models.add(modelKey);
    if (!scaleIsSafe(entry.defaultScale)) errors.push(`${id} has an unsafe default scale.`);
    if (!Number.isInteger(entry.compiledCrc) || entry.compiledCrc < 0 || entry.compiledCrc > 0xffffffff) {
      errors.push(`${id} has an unsafe compiled-resource CRC.`);
    }
    const sequences = Object.keys(entry.sequences);
    if (sequences.length < 1 || sequences.length > 8) errors.push(`${id} must define 1 through 8 sequences.`);
    if (!entry.sequences[entry.defaultSequence]) errors.push(`${id} has an unknown default sequence.`);
    for (const sequence of sequences) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(sequence)) {
        errors.push(`${id} has an unsafe sequence name ${sequence}.`);
      }
      if (entry.sequences[sequence].looping !== true) {
        errors.push(`${id}.${sequence} must be a proven looping sequence.`);
      }
    }
    if (
      entry.collision !== "none" || entry.createNavObstacle !== false ||
      entry.useAnimGraph !== false || entry.animateOnServer !== false
    ) {
      errors.push(`${id} must remain client-animated, non-solid, and navigation-neutral.`);
    }
    if (
      entry.visualBounds.min.some((value) => !Number.isFinite(value)) ||
      entry.visualBounds.max.some((value) => !Number.isFinite(value)) ||
      entry.visualBounds.min.some((value, axis) => value > entry.visualBounds.max[axis]) ||
      !entry.visualBounds.min.some((value, axis) => value < entry.visualBounds.max[axis])
    ) {
      errors.push(`${id} has invalid visual bounds.`);
    }
  }
  return errors;
}

export interface AnimatedPropRecipeInstallationReport {
  complete: boolean;
  modelCount: number;
  installedCount: number;
  currentCount: number | null;
  metadataVerified: boolean;
  missing: string[];
  stale: Array<{ model: string; expectedCrc: number; installedCrc: number }>;
}

/** Check exact models and, when CRCs are available, the saved animation/bounds metadata snapshot. */
export function inspectAnimatedPropRecipeInstallation(
  compiledResources: ReadonlySet<string> | ReadonlyMap<string, { crc: number }>,
): AnimatedPropRecipeInstallationReport {
  const hasCrcs = compiledResources instanceof Map;
  const normalized = new Map<string, number | undefined>();
  if (hasCrcs) {
    for (const [resource, entry] of compiledResources as ReadonlyMap<string, { crc: number }>) {
      normalized.set(resource.toLowerCase(), entry.crc);
    }
  } else {
    for (const resource of compiledResources as ReadonlySet<string>) {
      normalized.set(resource.toLowerCase(), undefined);
    }
  }
  const missing: string[] = [];
  const stale: AnimatedPropRecipeInstallationReport["stale"] = [];
  let installedCount = 0;
  let currentCount = 0;
  for (const entry of Object.values(ANIMATED_PROP_RECIPES)) {
    const compiledPath = `${entry.model}_c`.toLowerCase();
    if (!normalized.has(compiledPath)) {
      missing.push(entry.model);
      continue;
    }
    installedCount++;
    const installedCrc = normalized.get(compiledPath);
    if (hasCrcs && installedCrc === entry.compiledCrc) currentCount++;
    else if (hasCrcs && installedCrc !== undefined) {
      stale.push({ model: entry.model, expectedCrc: entry.compiledCrc, installedCrc });
    }
  }
  const modelCount = ANIMATED_PROP_RECIPE_IDS.length;
  return {
    complete: installedCount === modelCount,
    modelCount,
    installedCount,
    currentCount: hasCrcs ? currentCount : null,
    metadataVerified: hasCrcs,
    missing,
    stale,
  };
}
