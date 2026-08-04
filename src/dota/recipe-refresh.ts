import {
  RecipeSourceBaseline,
  RecipeVerificationBaseline,
  RecipeVerificationReport,
} from "./recipe-version.js";

export const RECIPE_REFRESH_EVIDENCE_IDS = [
  "typescript-build",
  "unit-tests",
  "mcp-smoke",
  "compiler-fixture",
  "acceptance-map",
] as const;

export type RecipeRefreshEvidenceId = typeof RECIPE_REFRESH_EVIDENCE_IDS[number];
export type RecipeRefreshEvidenceStatus = "passed" | "failed" | "skipped";

export interface RecipeRefreshEvidence {
  id: RecipeRefreshEvidenceId;
  status: RecipeRefreshEvidenceStatus;
  command?: string;
  detail?: string;
  observedAt?: string;
}

export interface RecipeSourceComparison {
  family: RecipeSourceBaseline["family"];
  path: string;
  baselineSha256: string;
  installedSha256: string | null;
  status: "matching" | "changed" | "missing";
}

export interface RecipeRefreshCheck {
  id: RecipeRefreshEvidenceId;
  title: string;
  purpose: string;
  command?: string;
  automatedBySafeRunner: boolean;
  required: boolean;
  status: "not-required" | "pending" | RecipeRefreshEvidenceStatus;
  detail?: string;
}

export interface RecipeRefreshReport {
  disposition:
    | "no-refresh-needed"
    | "metadata-incomplete"
    | "reverification-required"
    | "ready-for-manual-recording";
  verification: RecipeVerificationReport;
  changedFamilies: RecipeSourceBaseline["family"][];
  sourceComparisons: RecipeSourceComparison[];
  candidateBaseline: RecipeVerificationBaseline | null;
  checks: RecipeRefreshCheck[];
  recording: {
    automatic: false;
    allowed: boolean;
    blockers: string[];
    instruction: string;
  };
}

const CHECK_DEFINITIONS: Record<RecipeRefreshEvidenceId, Omit<RecipeRefreshCheck, "required" | "status" | "detail">> = {
  "typescript-build": {
    id: "typescript-build",
    title: "Build the MCP",
    purpose: "Proves the maintenance change still type-checks and produces a runnable server.",
    command: "npm run build",
    automatedBySafeRunner: true,
  },
  "unit-tests": {
    id: "unit-tests",
    title: "Run unit and integration tests",
    purpose: "Rechecks map specifications, recipes, conversion, validation, preview, and offline analysis.",
    command: "npm test",
    automatedBySafeRunner: true,
  },
  "mcp-smoke": {
    id: "mcp-smoke",
    title: "Run the MCP smoke suite",
    purpose: "Proves the built server exposes and executes its public tools without touching the live addon.",
    command: "npm run smoke",
    automatedBySafeRunner: true,
  },
  "compiler-fixture": {
    id: "compiler-fixture",
    title: "Compile the repository fixture",
    purpose: "Exercises Valve's current converter and resource compiler against checked terrain and volume geometry.",
    command: "npm run test:compiler-fixture",
    automatedBySafeRunner: true,
  },
  "acceptance-map": {
    id: "acceptance-map",
    title: "Compile and inspect a known-good acceptance map",
    purpose: "Confirms a real addon still compiles and its preview/reachability results remain plausible before trust moves forward.",
    automatedBySafeRunner: false,
  },
};

function sourceComparisons(report: RecipeVerificationReport): RecipeSourceComparison[] {
  return report.baseline.sources.map((source) => {
    const installed = report.installed.sourceHashes[source.path] ?? null;
    return {
      family: source.family,
      path: source.path,
      baselineSha256: source.sha256,
      installedSha256: installed,
      status: installed === null
        ? "missing"
        : installed.toUpperCase() === source.sha256.toUpperCase()
          ? "matching"
          : "changed",
    };
  });
}

function candidateBaseline(
  report: RecipeVerificationReport,
  verifiedAt: string,
): RecipeVerificationBaseline | null {
  const installed = report.installed;
  const requiredMetadata = [
    installed.appBuildId,
    installed.clientVersion,
    installed.serverVersion,
    installed.sourceRevision,
    installed.versionDate,
    installed.versionTime,
    installed.toolsDepotManifest,
  ];
  if (requiredMetadata.some((value) => !value)) return null;

  const sources = report.baseline.sources.map((source) => {
    const sha256 = installed.sourceHashes[source.path];
    return sha256 ? { ...source, sha256: sha256.toUpperCase() } : null;
  });
  if (sources.some((source) => source === null)) return null;

  return {
    verifiedAt,
    appBuildId: installed.appBuildId!,
    clientVersion: installed.clientVersion!,
    serverVersion: installed.serverVersion!,
    sourceRevision: installed.sourceRevision!,
    versionDate: installed.versionDate!,
    versionTime: installed.versionTime!,
    toolsDepotManifest: installed.toolsDepotManifest!,
    sources: sources as RecipeSourceBaseline[],
  };
}

/**
 * Build a read-only, evidence-gated refresh report. This function deliberately
 * cannot write RECIPE_VERIFICATION_BASELINE: a maintainer must review and record
 * the candidate in a separate source change after every required check passes.
 */
export function buildRecipeRefreshReport(
  verification: RecipeVerificationReport,
  evidence: readonly RecipeRefreshEvidence[] = [],
  verifiedAt = new Date().toISOString().slice(0, 10),
): RecipeRefreshReport {
  const comparisons = sourceComparisons(verification);
  const changed = new Set<RecipeSourceBaseline["family"]>(
    comparisons.filter((source) => source.status !== "matching").map((source) => source.family),
  );
  const toolsChanged = verification.findings.some((finding) => finding.code === "tools-changed");
  if (toolsChanged) {
    changed.add("terrain");
    changed.add("volume");
    changed.add("entity");
    changed.add("compiler");
  }
  const changedFamilies = [...changed].sort();
  const needsRefresh = verification.status === "changed";
  const candidate = candidateBaseline(verification, verifiedAt);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  const checks = RECIPE_REFRESH_EVIDENCE_IDS.map((id): RecipeRefreshCheck => {
    const definition = CHECK_DEFINITIONS[id];
    const required = needsRefresh;
    const observed = evidenceById.get(id);
    return {
      ...definition,
      required,
      status: observed?.status ?? (!required ? "not-required" : "pending"),
      detail: observed?.detail,
      command: observed?.command ?? definition.command,
    };
  });

  const blockers: string[] = [];
  if (verification.status === "verified" || verification.status === "compatible") {
    blockers.push("No trusted recipe source or Workshop-tools change requires a new baseline.");
  }
  if (verification.status === "incomplete" || !candidate) {
    blockers.push("Installed metadata or one or more authoritative source hashes are missing.");
  }
  for (const check of checks) {
    if (!check.required) continue;
    if (check.status === "pending") blockers.push(`${check.title} has not been recorded.`);
    if (check.status === "failed") blockers.push(`${check.title} failed.`);
    if (check.status === "skipped") blockers.push(`${check.title} was skipped.`);
  }

  const allowed = needsRefresh && candidate !== null && blockers.length === 0;
  const disposition = allowed
    ? "ready-for-manual-recording"
    : verification.status === "incomplete"
      ? "metadata-incomplete"
      : needsRefresh
        ? "reverification-required"
        : "no-refresh-needed";

  return {
    disposition,
    verification,
    changedFamilies,
    sourceComparisons: comparisons,
    candidateBaseline: needsRefresh ? candidate : null,
    checks,
    recording: {
      automatic: false,
      allowed,
      blockers,
      instruction: allowed
        ? "Review the evidence and candidate, then update RECIPE_VERIFICATION_BASELINE in a separate intentional commit."
        : "Do not change RECIPE_VERIFICATION_BASELINE until every blocker is resolved and reviewed.",
    },
  };
}
