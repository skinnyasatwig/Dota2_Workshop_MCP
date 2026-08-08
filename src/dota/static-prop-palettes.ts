export const STATIC_PROP_PALETTE_IDS = [
  "radiant-underbrush",
  "river-wetland",
  "rock-scatter",
  "natural-cliffs",
  "dire-debris",
] as const;

export type StaticPropPaletteId = typeof STATIC_PROP_PALETTE_IDS[number];
export type StaticPropPaletteCategory = "foliage" | "wetland" | "rock" | "cliff" | "debris";
export type StaticPropScale = number | readonly [number, number, number];

export interface StaticPropPaletteVariant {
  label: string;
  model: string;
  defaultScale: StaticPropScale;
}

export interface StaticPropPalette {
  id: StaticPropPaletteId;
  label: string;
  category: StaticPropPaletteCategory;
  intendedUse: string;
  collision: "none";
  source: string;
  variants: Readonly<Record<string, StaticPropPaletteVariant>>;
}

const palette = (
  id: StaticPropPaletteId,
  label: string,
  category: StaticPropPaletteCategory,
  intendedUse: string,
  variants: Readonly<Record<string, StaticPropPaletteVariant>>,
): StaticPropPalette => ({
  id,
  label,
  category,
  intendedUse,
  collision: "none",
  source: "Valve-authored compiled model present in the installed Dota pak01 VPK; repository compiler fixture",
  variants,
});

/**
 * Conservative visual-dressing palettes. These models are deliberately emitted as non-solid prop_static entities;
 * palette membership is evidence of availability and compiler compatibility, not an invented collision promise.
 */
export const STATIC_PROP_PALETTES: Readonly<Record<StaticPropPaletteId, StaticPropPalette>> = {
  "radiant-underbrush": palette(
    "radiant-underbrush",
    "Radiant underbrush",
    "foliage",
    "Low visual foliage around jungle edges and open ground; not a destructible Dota tree.",
    {
      "bush-round": { label: "Round bush", model: "models/props_nature/bush_00.vmdl", defaultScale: 1 },
      "bush-wide": { label: "Wide bush", model: "models/props_nature/bush_01.vmdl", defaultScale: 1 },
      "fern-a": { label: "Fern A", model: "models/props_nature/fern001.vmdl", defaultScale: 1 },
      "grass-a": { label: "Grass clump A", model: "models/props_nature/grass_clump_00a.vmdl", defaultScale: 1 },
    },
  ),
  "river-wetland": palette(
    "river-wetland",
    "River wetland",
    "wetland",
    "Visual reeds and floating plants for shallow river or bog dressing.",
    {
      "cattails-a": { label: "Cattails A", model: "models/props_nature/cattails001.vmdl", defaultScale: 1 },
      "cattails-b": { label: "Cattails B", model: "models/props_nature/cattails002.vmdl", defaultScale: 1 },
      "cattails-c": { label: "Cattails C", model: "models/props_nature/cattails003.vmdl", defaultScale: 1 },
      "lily-pads": { label: "Lily pads", model: "models/props_nature/lily_pads001.vmdl", defaultScale: 1 },
    },
  ),
  "rock-scatter": palette(
    "rock-scatter",
    "Rock scatter",
    "rock",
    "Small visual rocks for lane, riverbank, camp, and terrain-transition accents.",
    {
      "debris-a": { label: "Rock debris", model: "models/props_debris/rock_debris001.vmdl", defaultScale: 1 },
      "chips-a": { label: "Chipped rocks A", model: "models/props_nature/chipped_rocks001.vmdl", defaultScale: 1 },
      "chips-b": { label: "Chipped rocks B", model: "models/props_nature/chipped_rocks002.vmdl", defaultScale: 1 },
      "camp-ring": { label: "Campfire rocks", model: "models/props_nature/campfire_rocks001.vmdl", defaultScale: 1 },
    },
  ),
  "natural-cliffs": palette(
    "natural-cliffs",
    "Natural cliff dressing",
    "cliff",
    "Visual cliff-face accents; gameplay height and blocking still come from checked terrain or solids.",
    {
      "rock-face-a": { label: "Cliff rock A", model: "models/props_nature/cliff_rock001.vmdl", defaultScale: 1 },
      "rock-face-b": { label: "Cliff rock B", model: "models/props_nature/cliff_rock002.vmdl", defaultScale: 1 },
      "wall-face-a": { label: "Cliff wall A", model: "models/props_nature/cliff_wall001.vmdl", defaultScale: 1 },
      "wall-face-b": { label: "Cliff wall B", model: "models/props_nature/cliff_wall002.vmdl", defaultScale: 1 },
    },
  ),
  "dire-debris": palette(
    "dire-debris",
    "Dire debris",
    "debris",
    "Dry sticks and battlefield fragments for Dire-side or damaged terrain dressing.",
    {
      "sticks-a": { label: "Dire sticks A", model: "models/props_debris/bad_sticks001.vmdl", defaultScale: 1 },
      "sticks-b": { label: "Dire sticks B", model: "models/props_debris/bad_sticks002.vmdl", defaultScale: 1 },
      "battle-a": { label: "Battle debris A", model: "models/props_debris/battle_debris1.vmdl", defaultScale: 1 },
      "battle-b": { label: "Battle debris B", model: "models/props_debris/battle_debris2.vmdl", defaultScale: 1 },
    },
  ),
};

function scaleIsSafe(scale: StaticPropScale): boolean {
  const values: readonly number[] = typeof scale === "number" ? [scale] : scale;
  return values.every((value) => Number.isFinite(value) && value >= 0.01 && value <= 16);
}

export function staticPropPaletteVariant(
  paletteId: StaticPropPaletteId,
  variant: string,
): StaticPropPaletteVariant | undefined {
  return STATIC_PROP_PALETTES[paletteId].variants[variant];
}

export function validateStaticPropPaletteLibrary(): string[] {
  const errors: string[] = [];
  const modelPaths = new Set<string>();
  for (const id of STATIC_PROP_PALETTE_IDS) {
    const entry = STATIC_PROP_PALETTES[id];
    if (entry.id !== id) errors.push(`${id} has mismatched embedded id ${entry.id}.`);
    const variants = Object.entries(entry.variants);
    if (variants.length < 2 || variants.length > 16) {
      errors.push(`${id} must define 2 through 16 variants.`);
    }
    for (const [variant, definition] of variants) {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(variant)) {
        errors.push(`${id}.${variant} has an unsafe variant name.`);
      }
      if (
        !/^models\/[A-Za-z0-9_./-]+\.vmdl$/i.test(definition.model) ||
        definition.model.split("/").includes("..")
      ) {
        errors.push(`${id}.${variant} has an unsafe model path ${definition.model}.`);
      }
      const modelKey = definition.model.toLowerCase();
      if (modelPaths.has(modelKey)) errors.push(`${id}.${variant} duplicates model ${definition.model}.`);
      modelPaths.add(modelKey);
      if (!scaleIsSafe(definition.defaultScale)) {
        errors.push(`${id}.${variant} has an unsafe default scale.`);
      }
    }
  }
  return errors;
}

export interface StaticPropPaletteInstallationReport {
  complete: boolean;
  modelCount: number;
  installedCount: number;
  missing: string[];
  palettes: Array<{
    id: StaticPropPaletteId;
    installed: number;
    total: number;
    complete: boolean;
  }>;
}

/** Check the curated source-model names against one installed compiled-resource index. */
export function inspectStaticPropPaletteInstallation(
  compiledResources: ReadonlySet<string>,
): StaticPropPaletteInstallationReport {
  const normalized = new Set([...compiledResources].map((resource) => resource.toLowerCase()));
  const missing: string[] = [];
  const palettes = STATIC_PROP_PALETTE_IDS.map((id) => {
    const models = Object.values(STATIC_PROP_PALETTES[id].variants).map((variant) => variant.model);
    const installed = models.filter((model) => normalized.has(`${model.toLowerCase()}_c`)).length;
    for (const model of models) {
      if (!normalized.has(`${model.toLowerCase()}_c`)) missing.push(model);
    }
    return { id, installed, total: models.length, complete: installed === models.length };
  });
  const modelCount = palettes.reduce((count, entry) => count + entry.total, 0);
  const installedCount = palettes.reduce((count, entry) => count + entry.installed, 0);
  return {
    complete: installedCount === modelCount,
    modelCount,
    installedCount,
    missing: [...new Set(missing)].sort(),
    palettes,
  };
}
