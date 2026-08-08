import { join } from "node:path";
import { pathExists } from "../util/fsx.js";
import { transformModelBoundsFootprints } from "./map-collision.js";
import { STATIC_PROP_PALETTES, StaticPropPaletteId } from "./static-prop-palettes.js";
import { ParsedMapEntity } from "./vmap.js";
import { Vpk } from "./vpk.js";

export interface MapVisualPropFootprint {
  id: string;
  sourceIndex: number;
  targetname?: string;
  model: string;
  palette: StaticPropPaletteId;
  variant: string;
  points: [number, number][];
  minZ: number;
  maxZ: number;
  source: "crc-matched-render-bounds";
}

export interface MapVisualPropReport {
  matchedEntityCount: number;
  footprintCount: number;
  staleModelCount: number;
  shadowedModelCount: number;
  malformedTransformCount: number;
  footprints: MapVisualPropFootprint[];
  staleModels: Array<{
    model: string;
    expectedCrc: number;
    installedCrc: number | null;
  }>;
  shadowedModels: string[];
  shadowingWarnings: string[];
  malformedEntities: string[];
}

const modelVariants = new Map<string, {
  palette: StaticPropPaletteId;
  variant: string;
  compiledCrc: number;
  visualBounds: { min: [number, number, number]; max: [number, number, number] };
}>();
for (const [palette, definition] of Object.entries(STATIC_PROP_PALETTES)) {
  for (const [variant, entry] of Object.entries(definition.variants)) {
    modelVariants.set(entry.model.toLowerCase(), {
      palette: palette as StaticPropPaletteId,
      variant,
      compiledCrc: entry.compiledCrc,
      visualBounds: entry.visualBounds,
    });
  }
}

export function curatedVisualPropCandidateCount(entities: readonly ParsedMapEntity[]): number {
  return entities.filter((entity) =>
    entity.classname === "prop_static" &&
    !!entity.properties.model &&
    modelVariants.has(entity.properties.model.toLowerCase())).length;
}

export function curatedVisualPropModels(entities: readonly ParsedMapEntity[]): string[] {
  const models = new Map<string, string>();
  for (const entity of entities) {
    const model = entity.properties.model;
    if (entity.classname === "prop_static" && model && modelVariants.has(model.toLowerCase())) {
      models.set(model.toLowerCase(), model);
    }
  }
  return [...models.values()].sort((left, right) => left.localeCompare(right));
}

export function emptyMapVisualPropReport(): MapVisualPropReport {
  return {
    matchedEntityCount: 0,
    footprintCount: 0,
    staleModelCount: 0,
    shadowedModelCount: 0,
    malformedTransformCount: 0,
    footprints: [],
    staleModels: [],
    shadowedModels: [],
    shadowingWarnings: [],
    malformedEntities: [],
  };
}

/** Resolve only CRC-current curated render bounds. These outlines never participate in pathing. */
export function resolveCuratedVisualPropFootprints(
  entities: readonly ParsedMapEntity[],
  compiledResources: ReadonlyMap<string, { crc: number }>,
  options: { shadowedModels?: ReadonlySet<string> } = {},
): MapVisualPropReport {
  const footprints: MapVisualPropFootprint[] = [];
  const staleByModel = new Map<string, MapVisualPropReport["staleModels"][number]>();
  const shadowedInput = new Set([...(options.shadowedModels ?? [])].map((model) => model.toLowerCase()));
  const shadowedByModel = new Map<string, string>();
  const malformedEntities: string[] = [];
  let matchedEntityCount = 0;
  entities.forEach((entity, sourceIndex) => {
    if (entity.classname !== "prop_static") return;
    const model = entity.properties.model;
    if (!model) return;
    const curated = modelVariants.get(model.toLowerCase());
    if (!curated) return;
    matchedEntityCount++;
    if (shadowedInput.has(model.toLowerCase())) {
      shadowedByModel.set(model.toLowerCase(), model);
      return;
    }
    const installed = compiledResources.get(`${model.toLowerCase()}_c`);
    if (!installed || installed.crc !== curated.compiledCrc) {
      staleByModel.set(model.toLowerCase(), {
        model,
        expectedCrc: curated.compiledCrc,
        installedCrc: installed?.crc ?? null,
      });
      return;
    }
    const projected = transformModelBoundsFootprints(entity, [{
      ...curated.visualBounds,
      geometry: "bounds",
    }]);
    const footprint = projected?.[0];
    if (!footprint) {
      malformedEntities.push(entity.targetname ?? `#${sourceIndex}`);
      return;
    }
    footprints.push({
      id: entity.targetname ?? `#${sourceIndex}`,
      sourceIndex,
      targetname: entity.targetname,
      model,
      palette: curated.palette,
      variant: curated.variant,
      points: footprint.points,
      minZ: footprint.minZ,
      maxZ: footprint.maxZ,
      source: "crc-matched-render-bounds",
    });
  });
  return {
    matchedEntityCount,
    footprintCount: footprints.length,
    staleModelCount: staleByModel.size,
    shadowedModelCount: shadowedByModel.size,
    malformedTransformCount: malformedEntities.length,
    footprints,
    staleModels: [...staleByModel.values()].sort((left, right) => left.model.localeCompare(right.model)),
    shadowedModels: [...shadowedByModel.values()].sort((left, right) => left.localeCompare(right)),
    shadowingWarnings: [],
    malformedEntities,
  };
}

/** Resolve curated bounds with the active addon's loose and packed shadowing rules. */
export async function resolveProjectCuratedVisualPropFootprints(
  entities: readonly ParsedMapEntity[],
  baseCompiledResources: ReadonlyMap<string, { crc: number }>,
  addonGameDirectory: string,
): Promise<MapVisualPropReport> {
  const models = curatedVisualPropModels(entities);
  if (!models.length) return emptyMapVisualPropReport();
  const shadowedModels = new Set<string>();
  const looseChecks = await Promise.all(models.map(async (model) => ({
    model,
    exists: await pathExists(join(addonGameDirectory, `${model}_c`)),
  })));
  for (const check of looseChecks) {
    if (check.exists) shadowedModels.add(check.model.toLowerCase());
  }
  const addonVpkPath = join(addonGameDirectory, "pak01_dir.vpk");
  const shadowingWarnings: string[] = [];
  if (await pathExists(addonVpkPath)) {
    try {
      const addonVpk = await Vpk.open(addonVpkPath);
      for (const model of models) {
        if (addonVpk.entries.has(`${model.toLowerCase()}_c`)) shadowedModels.add(model.toLowerCase());
      }
    } catch (cause) {
      for (const model of models) shadowedModels.add(model.toLowerCase());
      shadowingWarnings.push(
        `Addon package could not be inspected; curated visual bounds were suppressed: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  const report = resolveCuratedVisualPropFootprints(entities, baseCompiledResources, { shadowedModels });
  report.shadowingWarnings.push(...shadowingWarnings);
  return report;
}
