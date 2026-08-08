export type Vector3 = [number, number, number];

export interface ModelVisualBounds {
  min: Vector3;
  max: Vector3;
}

function vector3(value: string): Vector3 | undefined {
  const numbers = value.split(",").map((part) => Number(part.trim()));
  if (numbers.length !== 3 || numbers.some((number) => !Number.isFinite(number))) return undefined;
  return numbers as Vector3;
}

function validBounds(bounds: ModelVisualBounds): boolean {
  return bounds.min.every((value, axis) => value <= bounds.max[axis]) &&
    bounds.min.some((value, axis) => value < bounds.max[axis]);
}

/**
 * Recover render-only bounds from Source2Viewer's MDAT text. The parser deliberately stops
 * before m_constraints/m_hitboxsets so hitboxes and PHYS data cannot be mislabeled as art size.
 */
export function parseVrfRenderBounds(output: string): ModelVisualBounds | undefined {
  const candidates: ModelVisualBounds[] = [];
  const sections = output.split(/--- Data for block "MDAT" ---/).slice(1);
  for (const section of sections) {
    const end = section.search(/--- Data for block "[A-Z0-9]+" ---/);
    const mdat = end >= 0 ? section.slice(0, end) : section;
    const sceneStart = mdat.indexOf("m_sceneObjects");
    if (sceneStart < 0) continue;
    const constraintsStart = mdat.indexOf("m_constraints", sceneStart);
    const sceneObjects = mdat.slice(sceneStart, constraintsStart >= 0 ? constraintsStart : undefined);
    const pattern = /m_vMinBounds\s*=\s*\[\s*([^\]]+)\s*\][\s\S]*?m_vMaxBounds\s*=\s*\[\s*([^\]]+)\s*\]/g;
    for (const match of sceneObjects.matchAll(pattern)) {
      const min = vector3(match[1]);
      const max = vector3(match[2]);
      if (min && max && validBounds({ min, max })) candidates.push({ min, max });
    }
  }
  if (!candidates.length) return undefined;
  return {
    min: [0, 1, 2].map((axis) => Math.min(...candidates.map((bounds) => bounds.min[axis]))) as Vector3,
    max: [0, 1, 2].map((axis) => Math.max(...candidates.map((bounds) => bounds.max[axis]))) as Vector3,
  };
}
