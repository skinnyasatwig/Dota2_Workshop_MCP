import { stat } from "node:fs/promises";

export interface MapArtifactFreshness {
  fresh: boolean;
  sourceModifiedMs: number;
  compiledModifiedMs: number;
  ageDeltaMs: number;
}

export function compareMapArtifactTimes(
  sourceModifiedMs: number,
  compiledModifiedMs: number,
): MapArtifactFreshness {
  return {
    fresh: compiledModifiedMs >= sourceModifiedMs,
    sourceModifiedMs,
    compiledModifiedMs,
    ageDeltaMs: compiledModifiedMs - sourceModifiedMs,
  };
}

export async function inspectMapArtifactFreshness(
  sourcePath: string,
  compiledPath: string,
): Promise<MapArtifactFreshness> {
  const [source, compiled] = await Promise.all([stat(sourcePath), stat(compiledPath)]);
  return compareMapArtifactTimes(source.mtimeMs, compiled.mtimeMs);
}
