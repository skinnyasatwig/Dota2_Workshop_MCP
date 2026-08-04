import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareRecipeBuildFingerprint,
  parseSteamAppManifest,
  parseSteamInf,
  RecipeBuildFingerprint,
  RecipeVerificationBaseline,
} from "../src/dota/recipe-version.js";

const baseline: RecipeVerificationBaseline = {
  verifiedAt: "2026-08-04",
  appBuildId: "100",
  clientVersion: "10",
  serverVersion: "10",
  sourceRevision: "500",
  versionDate: "Aug 04 2026",
  versionTime: "12:00:00",
  toolsDepotManifest: "9000",
  sources: [{ family: "terrain", path: "content/dota/maps/tilesets/test.vmap", sha256: "ABC123" }],
};

function installed(overrides: Partial<RecipeBuildFingerprint> = {}): RecipeBuildFingerprint {
  return {
    appBuildId: "100",
    clientVersion: "10",
    serverVersion: "10",
    sourceRevision: "500",
    versionDate: "Aug 04 2026",
    versionTime: "12:00:00",
    toolsDepotManifest: "9000",
    sourceHashes: { "content/dota/maps/tilesets/test.vmap": "ABC123" },
    ...overrides,
  };
}

test("Steam metadata parsers extract the Dota and tools fingerprints", () => {
  assert.deepEqual(parseSteamInf(`ClientVersion=6884\nServerVersion=6884\nSourceRevision=10879186\nVersionDate=Aug 03 2026\nVersionTime=15:49:07\n`), {
    clientVersion: "6884",
    serverVersion: "6884",
    sourceRevision: "10879186",
    versionDate: "Aug 03 2026",
    versionTime: "15:49:07",
  });
  assert.deepEqual(parseSteamAppManifest(`"AppState" { "buildid" "24541331" "InstalledDepots" { "381450" { "manifest" "8024482296929360461" } } }`), {
    appBuildId: "24541331",
    toolsDepotManifest: "8024482296929360461",
  });
});

test("exact recipe fingerprints remain verified", () => {
  const report = compareRecipeBuildFingerprint(installed(), baseline);
  assert.equal(report.status, "verified");
  assert.deepEqual(report.findings, []);
});

test("a newer app build stays compatible when recipe sources and tools are unchanged", () => {
  const report = compareRecipeBuildFingerprint(installed({ appBuildId: "101", sourceRevision: "501" }), baseline);
  assert.equal(report.status, "compatible");
  assert.deepEqual(report.findings.map((finding) => finding.code), ["build-changed", "source-revision-changed"]);
});

test("changed tools or source files require recipe re-verification", () => {
  const source = compareRecipeBuildFingerprint(installed({
    sourceHashes: { "content/dota/maps/tilesets/test.vmap": "DIFFERENT" },
  }), baseline);
  assert.equal(source.status, "changed");
  assert.equal(source.findings[0]?.code, "source-changed");

  const tools = compareRecipeBuildFingerprint(installed({ toolsDepotManifest: "9001" }), baseline);
  assert.equal(tools.status, "changed");
  assert.equal(tools.findings[0]?.code, "tools-changed");
});

test("missing install metadata is reported without pretending verification", () => {
  const report = compareRecipeBuildFingerprint(installed({ appBuildId: undefined }), baseline);
  assert.equal(report.status, "incomplete");
  assert.equal(report.findings[0]?.code, "metadata-missing");
});
