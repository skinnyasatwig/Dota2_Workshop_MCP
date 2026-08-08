import { buildStudioGallery, StudioResult } from "./studio.js";
import { requireDotaPaths } from "./paths.js";
import { openDotaVpk, VpkEntry } from "./vpk.js";
import {
  ANIMATED_PROP_RECIPES,
  AnimatedPropRecipeId,
} from "./animated-prop-recipes.js";

export interface AnimatedPropPreviewItem {
  sequence: string;
  label: string;
  looping: true;
}

export interface AnimatedPropPreviewPlan {
  recipeId: AnimatedPropRecipeId;
  label: string;
  intendedUse: string;
  model: string;
  compiledPath: string;
  expectedCrc: number;
  collision: "none";
  createNavObstacle: false;
  items: AnimatedPropPreviewItem[];
}

export interface AnimatedPropPreviewAudit {
  current: boolean;
  installed: boolean;
  expectedCrc: number;
  installedCrc: number | null;
}

export interface AnimatedPropPreviewResult extends StudioResult {
  plan: AnimatedPropPreviewPlan;
  audit: AnimatedPropPreviewAudit;
}

export function animatedPropPreviewPlan(
  recipeId: AnimatedPropRecipeId,
): AnimatedPropPreviewPlan {
  const recipe = ANIMATED_PROP_RECIPES[recipeId];
  return {
    recipeId,
    label: recipe.label,
    intendedUse: recipe.intendedUse,
    model: recipe.model,
    compiledPath: `${recipe.model}_c`.toLowerCase(),
    expectedCrc: recipe.compiledCrc,
    collision: recipe.collision,
    createNavObstacle: recipe.createNavObstacle,
    items: Object.entries(recipe.sequences).map(([sequence, definition]) => ({
      sequence,
      label: definition.label,
      looping: definition.looping,
    })),
  };
}

export function auditAnimatedPropPreview(
  plan: AnimatedPropPreviewPlan,
  entries: ReadonlyMap<string, Pick<VpkEntry, "crc">>,
): AnimatedPropPreviewAudit {
  const entry = entries.get(plan.compiledPath);
  return {
    current: entry?.crc === plan.expectedCrc,
    installed: Boolean(entry),
    expectedCrc: plan.expectedCrc,
    installedCrc: entry?.crc ?? null,
  };
}

/** Decode every checked loop from one exact CRC-current recipe into an animated browser gallery. */
export async function buildAnimatedPropPreview(
  recipeId: AnimatedPropRecipeId,
): Promise<AnimatedPropPreviewResult> {
  const plan = animatedPropPreviewPlan(recipeId);
  const paths = await requireDotaPaths();
  const vpk = await openDotaVpk(paths.pak01DirVpk);
  const audit = auditAnimatedPropPreview(plan, vpk.entries);
  if (!audit.current) {
    const detail = audit.installed
      ? `expected CRC ${audit.expectedCrc}, installed ${audit.installedCrc}`
      : "compiled model is missing";
    throw new Error(
      `Animated prop recipe ${recipeId} cannot be previewed safely: ${detail}. ` +
      "Refresh and review its sequence metadata before using the changed Valve asset.",
    );
  }

  const gallery = await buildStudioGallery({
    title: `${plan.label} - checked animated Dota prop`,
    particles: 0,
    sounds: 0,
    textures: 0,
    models: plan.items.length,
    exactModels: plan.items.map((item) => ({
      id: "570",
      title: "Dota 2 base game",
      path: plan.compiledPath,
      archivePath: paths.pak01DirVpk,
      name: `${item.label} - ${item.sequence}`,
      animationName: item.sequence,
    })),
  });
  if (gallery.counts.models !== plan.items.length) {
    throw new Error(
      `Animated prop recipe ${recipeId} decoded only ${gallery.counts.models}/${plan.items.length} sequences. ` +
      "The gallery was not accepted as complete.",
    );
  }
  return { ...gallery, plan, audit };
}
