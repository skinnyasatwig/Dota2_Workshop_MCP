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
  /** Installed pak01 entry used when the render-only bounds were measured. */
  compiledCrc: number;
  /** Valve MDAT scene-object bounds. Visual preview evidence only, never gameplay collision. */
  visualBounds: { min: [number, number, number]; max: [number, number, number] };
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

const variant = (
  label: string,
  model: string,
  compiledCrc: number,
  min: [number, number, number],
  max: [number, number, number],
  defaultScale: StaticPropScale = 1,
): StaticPropPaletteVariant => ({
  label,
  model,
  defaultScale,
  compiledCrc,
  visualBounds: { min, max },
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
      "bush-round": variant("Round bush", "models/props_nature/bush_00.vmdl", 3869836916,
        [-75.805275, -74.105576, 2.245515], [75.64151, 74.671188, 39.524082]),
      "bush-wide": variant("Wide bush", "models/props_nature/bush_01.vmdl", 1752389253,
        [-123.7836, -129.604568, 2.44939], [118.186348, 131.666504, 56.787319]),
      "fern-a": variant("Fern A", "models/props_nature/fern001.vmdl", 2851871870,
        [-98.010078, -94.517197, 2.02565], [92.91481, 140.7742, 71.337349]),
      "grass-a": variant("Grass clump A", "models/props_nature/grass_clump_00a.vmdl", 550937555,
        [-43.355709, -66.736961, 0.360078], [42.877106, 65.470291, 66.548241]),
    },
  ),
  "river-wetland": palette(
    "river-wetland",
    "River wetland",
    "wetland",
    "Visual reeds and floating plants for shallow river or bog dressing.",
    {
      "cattails-a": variant("Cattails A", "models/props_nature/cattails001.vmdl", 1123211691,
        [-81.407074, -61.345695, -6.148255], [74.327118, 77.327187, 262.325104]),
      "cattails-b": variant("Cattails B", "models/props_nature/cattails002.vmdl", 2079078777,
        [-49.282703, -54.955784, -5.928992], [53.187691, 55.39595, 207.738403]),
      "cattails-c": variant("Cattails C", "models/props_nature/cattails003.vmdl", 1849576876,
        [-57.695625, -57.95578, -4.708893], [62.359001, 57.66391, 164.39418]),
      "lily-pads": variant("Lily pads", "models/props_nature/lily_pads001.vmdl", 1867346537,
        [-91.996597, -191.367096, 3.499996], [97.31633, 146.850983, 3.500008]),
    },
  ),
  "rock-scatter": palette(
    "rock-scatter",
    "Rock scatter",
    "rock",
    "Small visual rocks for lane, riverbank, camp, and terrain-transition accents.",
    {
      "debris-a": variant("Rock debris", "models/props_debris/rock_debris001.vmdl", 153696938,
        [-392.091614, -87.806915, -2.015269], [144.466644, 137.495224, 87.314362]),
      "chips-a": variant("Chipped rocks A", "models/props_nature/chipped_rocks001.vmdl", 1177210382,
        [-54.965729, -53.760311, -1.079908], [54.965729, 53.760311, 45.769215]),
      "chips-b": variant("Chipped rocks B", "models/props_nature/chipped_rocks002.vmdl", 4096895030,
        [-46.626419, -37.6003, -1.88057], [46.626419, 37.6003, 40.257446]),
      "camp-ring": variant("Campfire rocks", "models/props_nature/campfire_rocks001.vmdl", 2886281271,
        [-48.221432, -44.104378, -0.302601], [48.077225, 43.390945, 44.669201]),
    },
  ),
  "natural-cliffs": palette(
    "natural-cliffs",
    "Natural cliff dressing",
    "cliff",
    "Visual cliff-face accents; gameplay height and blocking still come from checked terrain or solids.",
    {
      "rock-face-a": variant("Cliff rock A", "models/props_nature/cliff_rock001.vmdl", 2028167263,
        [-64.888931, -63.210388, -16.878969], [64.888931, 63.210388, 16.878969]),
      "rock-face-b": variant("Cliff rock B", "models/props_nature/cliff_rock002.vmdl", 3214206760,
        [-63.86412, -63.540272, -17.209427], [63.86412, 63.540272, 17.209427]),
      "wall-face-a": variant("Cliff wall A", "models/props_nature/cliff_wall001.vmdl", 7678254,
        [-145.907166, -226.33316, -2.591398], [145.907166, 226.33316, 295.142456]),
      "wall-face-b": variant("Cliff wall B", "models/props_nature/cliff_wall002.vmdl", 174876062,
        [-126.324295, -169.393417, -0.752512], [126.63752, 170.866196, 288.710815]),
    },
  ),
  "dire-debris": palette(
    "dire-debris",
    "Dire debris",
    "debris",
    "Dry sticks and battlefield fragments for Dire-side or damaged terrain dressing.",
    {
      "sticks-a": variant("Dire sticks A", "models/props_debris/bad_sticks001.vmdl", 3333903362,
        [-30.12248, -99.230225, -2.707053], [30.122482, 99.230225, 13.890182]),
      "sticks-b": variant("Dire sticks B", "models/props_debris/bad_sticks002.vmdl", 2588594537,
        [-34.82608, -111.063065, -31.414379], [34.82608, 111.063065, 47.414379]),
      "battle-a": variant("Battle debris A", "models/props_debris/battle_debris1.vmdl", 3723641615,
        [-129.258057, -87.335938, -13.330406], [87.258057, 99.335938, 43.780109]),
      "battle-b": variant("Battle debris B", "models/props_debris/battle_debris2.vmdl", 3438009814,
        [-70.045837, -29.381805, -9.130701], [64.045837, 49.381805, 22.730701]),
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
      if (!Number.isInteger(definition.compiledCrc) || definition.compiledCrc < 0 || definition.compiledCrc > 0xffffffff) {
        errors.push(`${id}.${variant} has an unsafe compiled-resource CRC.`);
      }
      if (
        definition.visualBounds.min.some((value) => !Number.isFinite(value)) ||
        definition.visualBounds.max.some((value) => !Number.isFinite(value)) ||
        definition.visualBounds.min.some((value, axis) => value > definition.visualBounds.max[axis]) ||
        !definition.visualBounds.min.some((value, axis) => value < definition.visualBounds.max[axis])
      ) {
        errors.push(`${id}.${variant} has invalid visual bounds.`);
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
  visualBoundsVerified: boolean;
  currentVisualBoundsCount: number | null;
  staleVisualBounds: Array<{
    model: string;
    expectedCrc: number;
    installedCrc: number;
  }>;
  palettes: Array<{
    id: StaticPropPaletteId;
    installed: number;
    total: number;
    complete: boolean;
    currentVisualBounds: number | null;
  }>;
}

/** Check the curated source-model names against one installed compiled-resource index. */
export function inspectStaticPropPaletteInstallation(
  compiledResources: ReadonlySet<string> | ReadonlyMap<string, { crc: number }>,
): StaticPropPaletteInstallationReport {
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
  const staleVisualBounds: StaticPropPaletteInstallationReport["staleVisualBounds"] = [];
  const palettes = STATIC_PROP_PALETTE_IDS.map((id) => {
    const variants = Object.values(STATIC_PROP_PALETTES[id].variants);
    const installed = variants.filter((variant) => normalized.has(`${variant.model.toLowerCase()}_c`)).length;
    let currentVisualBounds = 0;
    for (const variant of variants) {
      const compiled = `${variant.model.toLowerCase()}_c`;
      if (!normalized.has(compiled)) {
        missing.push(variant.model);
        continue;
      }
      const installedCrc = normalized.get(compiled);
      if (hasCrcs && installedCrc === variant.compiledCrc) currentVisualBounds++;
      else if (hasCrcs && installedCrc !== undefined) {
        staleVisualBounds.push({
          model: variant.model,
          expectedCrc: variant.compiledCrc,
          installedCrc,
        });
      }
    }
    return {
      id,
      installed,
      total: variants.length,
      complete: installed === variants.length,
      currentVisualBounds: hasCrcs ? currentVisualBounds : null,
    };
  });
  const modelCount = palettes.reduce((count, entry) => count + entry.total, 0);
  const installedCount = palettes.reduce((count, entry) => count + entry.installed, 0);
  return {
    complete: installedCount === modelCount,
    modelCount,
    installedCount,
    missing: [...new Set(missing)].sort(),
    visualBoundsVerified: hasCrcs,
    currentVisualBoundsCount: hasCrcs
      ? palettes.reduce((count, entry) => count + (entry.currentVisualBounds ?? 0), 0)
      : null,
    staleVisualBounds,
    palettes,
  };
}
