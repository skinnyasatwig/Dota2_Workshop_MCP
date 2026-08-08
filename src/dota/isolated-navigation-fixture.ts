export const ISOLATED_NAV_TERRAIN_OFFSET = 32768;

/** Move only Valve's tile grid far from an engine-navigation probe site. */
export function relocateTileGridForIsolatedNavigation(
  text: string,
  offsetX = ISOLATED_NAV_TERRAIN_OFFSET,
  offsetY = ISOLATED_NAV_TERRAIN_OFFSET,
): string {
  const marker = text.indexOf('"CMapDotaTileGrid"');
  if (marker < 0) throw new Error("An isolated navigation fixture cannot relocate a missing tile grid.");
  const relative = text.slice(marker);
  const match = /"origin"\s+"vector3"\s+"([^"]+)"/.exec(relative);
  if (!match || match.index === undefined) throw new Error("The navigation fixture tile grid has no origin.");
  const original = match[1].trim().split(/\s+/).map(Number);
  if (original.length !== 3 || original.some((value) => !Number.isFinite(value))) {
    throw new Error("The navigation fixture tile-grid origin is malformed.");
  }
  const next = `${original[0] + offsetX} ${original[1] + offsetY} ${original[2]}`;
  const start = marker + match.index;
  return text.slice(0, start) + match[0].replace(match[1], next) + text.slice(start + match[0].length);
}
