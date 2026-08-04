export type CornerPattern =
  | "0000" | "0001" | "0010" | "0011"
  | "0100" | "0101" | "0110" | "0111"
  | "1000" | "1001" | "1010" | "1011"
  | "1100" | "1101" | "1110" | "1111";

export interface CoreTerrainRecipe {
  id: string;
  label: string;
  cornerPattern: CornerPattern | "one-raised" | "two-adjacent" | "two-opposite" | "three-raised";
  nodeId: number;
  source: string;
}

export interface CliffRecipeSet {
  id: string;
  label: string;
  tileset: number;
  source: string;
  recipes: Record<1 | 2 | 3, number[]>;
}

export interface ValvePrefabRecipe {
  id: string;
  category: "base" | "ancient" | "tower" | "fountain" | "shop" | "camp" | "boss";
  label: string;
  source: string;
  use: string;
}

export const ORIENTATION_BY_PATTERN: Readonly<Record<CornerPattern, number>> = {
  "0000": 0,
  "0001": 3,
  "0010": 0,
  "0011": 0,
  "0100": 2,
  "0101": 3,
  "0110": 0,
  "0111": 3,
  "1000": 1,
  "1001": 1,
  "1010": 1,
  "1011": 0,
  "1100": 2,
  "1101": 2,
  "1110": 1,
  "1111": 0,
};

export const CORE_TERRAIN_RECIPES: readonly CoreTerrainRecipe[] = [
  {
    id: "flat-core",
    label: "Flat ground core",
    cornerPattern: "0000",
    nodeId: 5292,
    source: "maps/tilesets/radiant_basic.vmap and dire_basic.vmap",
  },
  {
    id: "one-raised-core",
    label: "One raised corner",
    cornerPattern: "one-raised",
    nodeId: 5183,
    source: "maps/tilesets/radiant_basic.vmap and dire_basic.vmap",
  },
  {
    id: "two-adjacent-core",
    label: "Two adjacent raised corners",
    cornerPattern: "two-adjacent",
    nodeId: 5186,
    source: "maps/tilesets/radiant_basic.vmap and dire_basic.vmap",
  },
  {
    id: "two-opposite-core",
    label: "Two opposite raised corners",
    cornerPattern: "two-opposite",
    nodeId: 5177,
    source: "maps/tilesets/radiant_basic.vmap and dire_basic.vmap",
  },
  {
    id: "three-raised-core",
    label: "Three raised corners",
    cornerPattern: "three-raised",
    nodeId: 5180,
    source: "maps/tilesets/radiant_basic.vmap and dire_basic.vmap",
  },
] as const;

const coreByKind = new Map(CORE_TERRAIN_RECIPES.map((recipe) => [recipe.cornerPattern, recipe.nodeId]));

export const CLIFF_RECIPE_SETS: readonly CliffRecipeSet[] = [
  {
    id: "radiant-basic-cliffs",
    label: "Radiant basic cliff decoration",
    tileset: 0,
    source: "maps/tilesets/radiant_basic.vmap; verified in the official template tile-grid pipeline",
    recipes: {
      1: [5183, -1, 5925, 5938, -1, 6967, 5939, -1, 20862, 5939, 20884, -1],
      2: [5186, -1, 5943, 5949, -1, 21178, 5949, 21180, -1, 5948, 5950, -1, 0, 5950, 6080, -1],
      3: [5180, -1, 6487, 5974, -1, 20900, 5974, 20915, -1, 5969, 5975, -1],
    },
  },
  {
    id: "dire-basic-cliffs",
    label: "Dire basic cliff decoration",
    tileset: 1,
    source: "maps/tilesets/dire_basic.vmap; verified in the official template tile-grid pipeline",
    recipes: {
      1: [5183, -1, 6361, 5938, -1, 6382, 5939, -1, 15301, 5939, 15346, -1],
      2: [5186, -1, 5944, 5949, -1, 15412, 5949, 15511, -1, 5948, 5950, -1, 0, 5950, 6080, -1],
      3: [5180, -1, 6468, 5974, -1, 15616, 5974, 15624, -1, 5969, 5975, -1],
    },
  },
] as const;

const cliffByTileset = new Map(CLIFF_RECIPE_SETS.map((recipe) => [recipe.tileset, recipe]));

export const VALVE_PREFAB_RECIPES: readonly ValvePrefabRecipe[] = [
  { id: "basic-radiant", category: "base", label: "Radiant basic gameplay entities", source: "maps/prefabs/basic_entities_radiant.vmap", use: "Reference entity arrangement and team defaults." },
  { id: "basic-dire", category: "base", label: "Dire basic gameplay entities", source: "maps/prefabs/basic_entities_dire.vmap", use: "Reference entity arrangement and team defaults." },
  { id: "ancient-radiant", category: "ancient", label: "Radiant Ancient", source: "maps/prefabs/structure_ancient_radiant.vmap", use: "Visual/reference prefab for Radiant Ancient structure." },
  { id: "ancient-dire", category: "ancient", label: "Dire Ancient", source: "maps/prefabs/structure_ancient_dire.vmap", use: "Visual/reference prefab for Dire Ancient structure." },
  { id: "tower-radiant", category: "tower", label: "Radiant tower", source: "maps/prefabs/structure_tower_radiant.vmap", use: "Visual/reference prefab for Radiant towers." },
  { id: "tower-dire", category: "tower", label: "Dire tower", source: "maps/prefabs/structure_tower_dire.vmap", use: "Visual/reference prefab for Dire towers." },
  { id: "fountain-radiant", category: "fountain", label: "Radiant fountain", source: "maps/prefabs/structure_fountain_radiant_basic.vmap", use: "Visual/reference prefab for a basic Radiant fountain." },
  { id: "fountain-dire", category: "fountain", label: "Dire fountain", source: "maps/prefabs/structure_fountain_dire_basic.vmap", use: "Visual/reference prefab for a basic Dire fountain." },
  { id: "shop-radiant", category: "shop", label: "Radiant shopkeeper", source: "maps/prefabs/shop_keeper_radiant.vmap", use: "Visual/reference prefab for Radiant shop decoration." },
  { id: "shop-dire", category: "shop", label: "Dire shopkeeper", source: "maps/prefabs/shop_keeper_dire.vmap", use: "Visual/reference prefab for Dire shop decoration." },
  { id: "neutral-camp", category: "camp", label: "Neutral camp", source: "maps/prefabs/neutral_camp.vmap", use: "Reference camp spawner and blocking-volume arrangement." },
  { id: "river-camp", category: "camp", label: "River neutral camp", source: "maps/prefabs/creep_camp_river.vmap", use: "Reference water/river camp arrangement." },
  { id: "roshan", category: "boss", label: "Roshan", source: "maps/prefabs/npc_roshan.vmap", use: "Reference Roshan presentation prefab." },
] as const;

export function cornerPattern(corners: readonly number[]): CornerPattern {
  if (corners.length !== 4 || corners.some((height) => !Number.isFinite(height))) {
    throw new Error("A terrain corner pattern requires four finite heights.");
  }
  const minimum = Math.min(...corners);
  const maximum = Math.max(...corners);
  return (
    maximum === minimum
      ? "0000"
      : corners.map((height) => (height === maximum ? "1" : "0")).join("")
  ) as CornerPattern;
}

export function orientationForCornerPattern(pattern: CornerPattern): number {
  return ORIENTATION_BY_PATTERN[pattern];
}

export function coreTileNodeForPattern(pattern: CornerPattern): number {
  const raisedCorners = [...pattern].filter((value) => value === "1").length;
  if (raisedCorners === 0) return coreByKind.get("0000")!;
  if (raisedCorners === 1) return coreByKind.get("one-raised")!;
  if (raisedCorners === 3) return coreByKind.get("three-raised")!;
  if (pattern === "0110" || pattern === "1001") return coreByKind.get("two-opposite")!;
  return coreByKind.get("two-adjacent")!;
}

export function terrainRecipeForCell(
  pattern: CornerPattern,
  tileset: number,
  ramp: boolean,
): number[] {
  const core = coreTileNodeForPattern(pattern);
  const raisedCorners = [...pattern].filter((value) => value === "1").length;
  if (raisedCorners === 0 || ramp || (raisedCorners === 2 && (pattern === "0110" || pattern === "1001"))) {
    return [core, -1];
  }
  return [...(cliffByTileset.get(tileset)?.recipes[raisedCorners as 1 | 2 | 3] ?? [core, -1])];
}

export function validateTerrainRecipeLibrary(): string[] {
  const errors: string[] = [];
  if (Object.keys(ORIENTATION_BY_PATTERN).length !== 16) {
    errors.push("Orientation library must define all 16 corner patterns.");
  }
  for (const recipe of CORE_TERRAIN_RECIPES) {
    if (!Number.isInteger(recipe.nodeId) || recipe.nodeId <= 0) {
      errors.push(`${recipe.id} has invalid core node ${recipe.nodeId}.`);
    }
  }
  for (const set of CLIFF_RECIPE_SETS) {
    for (const raised of [1, 2, 3] as const) {
      const recipe = set.recipes[raised];
      if (!recipe.length || recipe[recipe.length - 1] !== -1) {
        errors.push(`${set.id} raised-${raised} recipe must end with -1.`);
      }
      const expectedCore = raised === 1 ? 5183 : raised === 2 ? 5186 : 5180;
      if (recipe[0] !== expectedCore) {
        errors.push(`${set.id} raised-${raised} recipe must begin with core node ${expectedCore}.`);
      }
    }
  }
  const prefabIds = new Set<string>();
  for (const prefab of VALVE_PREFAB_RECIPES) {
    if (prefabIds.has(prefab.id)) errors.push(`Duplicate prefab recipe id ${prefab.id}.`);
    prefabIds.add(prefab.id);
    if (!prefab.source.startsWith("maps/prefabs/") || !prefab.source.endsWith(".vmap")) {
      errors.push(`${prefab.id} does not point to a Valve VMAP prefab.`);
    }
  }
  return errors;
}
