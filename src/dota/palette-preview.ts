import { buildStudioGallery, StudioResult } from "./studio.js";
import { requireDotaPaths } from "./paths.js";
import { openDotaVpk, VpkEntry } from "./vpk.js";
import {
  STATIC_PROP_PALETTES,
  StaticPropPaletteId,
} from "./static-prop-palettes.js";

export interface StaticPropPalettePreviewItem {
  variant: string;
  label: string;
  model: string;
  compiledPath: string;
  expectedCrc: number;
}

export interface StaticPropPalettePreviewPlan {
  paletteId: StaticPropPaletteId;
  label: string;
  category: string;
  intendedUse: string;
  collision: "none";
  items: StaticPropPalettePreviewItem[];
}

export interface StaticPropPalettePreviewAudit {
  current: boolean;
  installedCount: number;
  currentCount: number;
  missing: string[];
  stale: Array<{
    variant: string;
    model: string;
    expectedCrc: number;
    installedCrc: number;
  }>;
}

export interface StaticPropPalettePreviewResult extends StudioResult {
  plan: StaticPropPalettePreviewPlan;
  audit: StaticPropPalettePreviewAudit;
}

/** Resolve one curated palette into an exact, bounded four-model preview plan. */
export function staticPropPalettePreviewPlan(
  paletteId: StaticPropPaletteId,
): StaticPropPalettePreviewPlan {
  const palette = STATIC_PROP_PALETTES[paletteId];
  return {
    paletteId,
    label: palette.label,
    category: palette.category,
    intendedUse: palette.intendedUse,
    collision: palette.collision,
    items: Object.entries(palette.variants).map(([variant, definition]) => ({
      variant,
      label: definition.label,
      model: definition.model,
      compiledPath: `${definition.model}_c`.toLowerCase(),
      expectedCrc: definition.compiledCrc,
    })),
  };
}

/** Verify that the installed base-game resources still match the curated snapshots. */
export function auditStaticPropPalettePreview(
  plan: StaticPropPalettePreviewPlan,
  entries: ReadonlyMap<string, Pick<VpkEntry, "crc">>,
): StaticPropPalettePreviewAudit {
  const missing: string[] = [];
  const stale: StaticPropPalettePreviewAudit["stale"] = [];
  let installedCount = 0;
  let currentCount = 0;
  for (const item of plan.items) {
    const entry = entries.get(item.compiledPath);
    if (!entry) {
      missing.push(item.model);
      continue;
    }
    installedCount++;
    if (entry.crc === item.expectedCrc) {
      currentCount++;
    } else {
      stale.push({
        variant: item.variant,
        model: item.model,
        expectedCrc: item.expectedCrc,
        installedCrc: entry.crc,
      });
    }
  }
  return {
    current: currentCount === plan.items.length,
    installedCount,
    currentCount,
    missing,
    stale,
  };
}

/** Decode exactly one checked palette into the existing browser-based 3D studio. */
export async function buildStaticPropPalettePreview(
  paletteId: StaticPropPaletteId,
): Promise<StaticPropPalettePreviewResult> {
  const plan = staticPropPalettePreviewPlan(paletteId);
  const paths = await requireDotaPaths();
  const vpk = await openDotaVpk(paths.pak01DirVpk);
  const audit = auditStaticPropPalettePreview(plan, vpk.entries);
  if (!audit.current) {
    const details = [
      ...audit.missing.map((model) => `missing ${model}`),
      ...audit.stale.map((entry) =>
        `stale ${entry.model} (expected CRC ${entry.expectedCrc}, installed ${entry.installedCrc})`),
    ];
    throw new Error(
      `Palette ${paletteId} cannot be previewed safely: ${details.join("; ")}. ` +
      "Refresh and review the curated palette evidence before using changed Valve assets.",
    );
  }

  const gallery = await buildStudioGallery({
    title: `${plan.label} — checked Dota scenery palette`,
    particles: 0,
    sounds: 0,
    textures: 0,
    models: plan.items.length,
    exactModels: plan.items.map((item) => ({
      id: "570",
      title: "Dota 2 base game",
      path: item.compiledPath,
      archivePath: paths.pak01DirVpk,
      name: `${item.variant} — ${item.label}`,
    })),
  });
  if (gallery.counts.models !== plan.items.length) {
    throw new Error(
      `Palette ${paletteId} decoded only ${gallery.counts.models}/${plan.items.length} models. ` +
      "The gallery was not accepted as complete.",
    );
  }
  return { ...gallery, plan, audit };
}
