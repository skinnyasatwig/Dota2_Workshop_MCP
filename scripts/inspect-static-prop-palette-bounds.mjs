import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { STATIC_PROP_PALETTES } from "../dist/dota/static-prop-palettes.js";
import { parseVrfRenderBounds } from "../dist/dota/model-visual.js";
import { resolveDotaPaths } from "../dist/dota/paths.js";
import { Vpk } from "../dist/dota/vpk.js";
import { ensureVrf } from "../dist/dota/vrf.js";

const execFileAsync = promisify(execFile);
const dota = await resolveDotaPaths();
if (!dota) throw new Error("Dota 2 Workshop Tools were not found.");
const vpk = await Vpk.open(dota.pak01DirVpk);
const exe = await ensureVrf();
const result = {};
const mismatches = [];
let checked = 0;

for (const palette of Object.values(STATIC_PROP_PALETTES)) {
  result[palette.id] = {};
  for (const [variantId, variant] of Object.entries(palette.variants)) {
    const compiled = `${variant.model}_c`.toLowerCase();
    const entry = vpk.entries.get(compiled);
    if (!entry) throw new Error(`${compiled} is absent from ${dota.pak01DirVpk}.`);
    const { stdout } = await execFileAsync(exe, [
      "-i", dota.pak01DirVpk,
      "-f", compiled,
      "-a",
    ], { cwd: resolve("."), windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 120_000 });
    const visualBounds = parseVrfRenderBounds(stdout);
    if (!visualBounds) throw new Error(`${variant.model} has no validated MDAT scene-object bounds.`);
    result[palette.id][variantId] = { compiledCrc: entry.crc, visualBounds };
    checked++;
    if (
      entry.crc !== variant.compiledCrc ||
      JSON.stringify(visualBounds) !== JSON.stringify(variant.visualBounds)
    ) {
      mismatches.push({
        palette: palette.id,
        variant: variantId,
        model: variant.model,
        expected: { compiledCrc: variant.compiledCrc, visualBounds: variant.visualBounds },
        installed: { compiledCrc: entry.crc, visualBounds },
      });
    }
  }
}

if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else if (mismatches.length) {
  console.error(JSON.stringify(mismatches, null, 2));
  throw new Error(`${mismatches.length} curated visual-bound snapshot(s) are stale.`);
} else {
  console.log(`${checked}/${checked} curated model render bounds match their installed VPK CRC and MDAT snapshot.`);
}
