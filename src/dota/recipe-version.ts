import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DotaPaths } from "./paths.js";

export interface RecipeSourceBaseline {
  family: "terrain" | "volume" | "entity" | "compiler";
  path: string;
  sha256: string;
}

export interface RecipeBuildFingerprint {
  appBuildId?: string;
  clientVersion?: string;
  serverVersion?: string;
  sourceRevision?: string;
  versionDate?: string;
  versionTime?: string;
  toolsDepotManifest?: string;
  sourceHashes: Record<string, string | null>;
}

export interface RecipeVerificationBaseline {
  verifiedAt: string;
  appBuildId: string;
  clientVersion: string;
  serverVersion: string;
  sourceRevision: string;
  versionDate: string;
  versionTime: string;
  toolsDepotManifest: string;
  sources: readonly RecipeSourceBaseline[];
}

export interface RecipeVersionFinding {
  severity: "info" | "warn";
  code: "build-changed" | "source-revision-changed" | "tools-changed" | "source-changed" | "source-missing" | "metadata-missing";
  detail: string;
}

export interface RecipeVerificationReport {
  status: "verified" | "compatible" | "changed" | "incomplete";
  baseline: RecipeVerificationBaseline;
  installed: RecipeBuildFingerprint;
  findings: RecipeVersionFinding[];
}

export const DOTA_TOOLS_WINDOWS_DEPOT_ID = "381450";

/** Baseline captured after converter, compiler, FGD, and 3v3 acceptance verification. */
export const RECIPE_VERIFICATION_BASELINE: RecipeVerificationBaseline = {
  verifiedAt: "2026-08-04",
  appBuildId: "24541331",
  clientVersion: "6884",
  serverVersion: "6884",
  sourceRevision: "10879186",
  versionDate: "Aug 03 2026",
  versionTime: "15:49:07",
  toolsDepotManifest: "8024482296929360461",
  sources: [
    {
      family: "terrain",
      path: "content/dota/maps/tilesets/radiant_basic.vmap",
      sha256: "B4E17FCA21E23942B2D0D72A1EAE179011CA12E228DC8ED3BC8C6BAD0F1FE627",
    },
    {
      family: "terrain",
      path: "content/dota/maps/tilesets/dire_basic.vmap",
      sha256: "71EC2DECE1F0DF388F1AA66BA506619AD1BA02EBE597B293A32E05B2E3DCFA6B",
    },
    {
      family: "volume",
      path: "content/dota/maps/prefabs/dota_pvp_prefab.vmap",
      sha256: "AD46A717F575BB985A79B8DDE5A9513F8CF36E143E2510E8A5C3562ED9FCA461",
    },
    {
      family: "entity",
      path: "game/dota/dota.fgd",
      sha256: "825430610E0EA5618175BFD488E4C6FAE60C6873C1F57132D287F1E71C1E5D2B",
    },
    {
      family: "compiler",
      path: "game/bin/win64/resourcecompiler.exe",
      sha256: "D5E3F874F209AF6E8F038AAB5DA07480FB8FDCFF9CB65416DD3782A7C7EDBF93",
    },
  ],
};

export function parseSteamInf(text: string): Omit<RecipeBuildFingerprint, "appBuildId" | "toolsDepotManifest" | "sourceHashes"> {
  const values = Object.fromEntries(
    text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  return {
    clientVersion: values.ClientVersion,
    serverVersion: values.ServerVersion,
    sourceRevision: values.SourceRevision,
    versionDate: values.VersionDate,
    versionTime: values.VersionTime,
  };
}

export function parseSteamAppManifest(
  text: string,
  toolsDepotId = DOTA_TOOLS_WINDOWS_DEPOT_ID,
): Pick<RecipeBuildFingerprint, "appBuildId" | "toolsDepotManifest"> {
  const escapedDepot = toolsDepotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    appBuildId: /"buildid"\s+"([^"]+)"/i.exec(text)?.[1],
    toolsDepotManifest: new RegExp(`"${escapedDepot}"\\s*\\{[\\s\\S]*?"manifest"\\s*"([^"]+)"`, "i").exec(text)?.[1],
  };
}

async function optionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function optionalSha256(path: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex").toUpperCase();
  } catch {
    return null;
  }
}

export async function collectRecipeBuildFingerprint(
  dota: DotaPaths,
  baseline = RECIPE_VERIFICATION_BASELINE,
): Promise<RecipeBuildFingerprint> {
  const appManifestPath = resolve(dota.root, "..", "..", "appmanifest_570.acf");
  const [steamInf, appManifest, sourceHashes] = await Promise.all([
    optionalText(join(dota.dotaGameDir, "steam.inf")),
    optionalText(appManifestPath),
    Promise.all(baseline.sources.map(async (source) => [source.path, await optionalSha256(join(dota.root, source.path))] as const)),
  ]);
  return {
    ...(steamInf ? parseSteamInf(steamInf) : {}),
    ...(appManifest ? parseSteamAppManifest(appManifest) : {}),
    sourceHashes: Object.fromEntries(sourceHashes),
  };
}

export function compareRecipeBuildFingerprint(
  installed: RecipeBuildFingerprint,
  baseline = RECIPE_VERIFICATION_BASELINE,
): RecipeVerificationReport {
  const findings: RecipeVersionFinding[] = [];
  let sourceProblem = false;
  for (const source of baseline.sources) {
    const actual = installed.sourceHashes[source.path];
    if (!actual) {
      sourceProblem = true;
      findings.push({ severity: "warn", code: "source-missing", detail: `Missing recipe source: ${source.path}.` });
    } else if (actual.toUpperCase() !== source.sha256) {
      sourceProblem = true;
      findings.push({ severity: "warn", code: "source-changed", detail: `Recipe source changed: ${source.path}.` });
    }
  }
  let toolsProblem = false;
  if (!installed.toolsDepotManifest) {
    toolsProblem = true;
    findings.push({ severity: "warn", code: "metadata-missing", detail: "Workshop-tools depot manifest is unavailable." });
  } else if (installed.toolsDepotManifest !== baseline.toolsDepotManifest) {
    toolsProblem = true;
    findings.push({
      severity: "warn",
      code: "tools-changed",
      detail: `Workshop tools changed (${baseline.toolsDepotManifest} -> ${installed.toolsDepotManifest}).`,
    });
  }
  if (!installed.appBuildId) {
    findings.push({ severity: "warn", code: "metadata-missing", detail: "Steam app build ID is unavailable." });
  } else if (installed.appBuildId !== baseline.appBuildId) {
    findings.push({
      severity: "info",
      code: "build-changed",
      detail: `Dota app build changed (${baseline.appBuildId} -> ${installed.appBuildId}).`,
    });
  }
  if (!installed.sourceRevision) {
    findings.push({ severity: "warn", code: "metadata-missing", detail: "Dota source revision is unavailable." });
  } else if (installed.sourceRevision !== baseline.sourceRevision) {
    findings.push({
      severity: "info",
      code: "source-revision-changed",
      detail: `Dota source revision changed (${baseline.sourceRevision} -> ${installed.sourceRevision}).`,
    });
  }
  const missingMetadata = findings.some((finding) => finding.code === "metadata-missing");
  const versionChanged = findings.some((finding) =>
    finding.code === "build-changed" || finding.code === "source-revision-changed");
  return {
    status: sourceProblem || toolsProblem ? "changed" : missingMetadata ? "incomplete" : versionChanged ? "compatible" : "verified",
    baseline,
    installed,
    findings,
  };
}

export async function verifyInstalledRecipeVersion(
  dota: DotaPaths,
  baseline = RECIPE_VERIFICATION_BASELINE,
): Promise<RecipeVerificationReport> {
  return compareRecipeBuildFingerprint(await collectRecipeBuildFingerprint(dota, baseline), baseline);
}
