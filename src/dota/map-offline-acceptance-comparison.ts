export interface OfflineAcceptanceMetricSnapshot {
  acceptancePass: boolean;
  metrics: {
    validationFindings: number;
    validationWarnings: number;
    validationErrors: number;
    entityCount: number;
    requirementCount: number;
    walkableCells: number;
    reachableCells: number;
    unreachableCells: number;
    holeCells: number;
    regionCount: number;
    waterCells: number;
    cliffCells: number;
    rampCells: number;
    entityOverlays: number;
    pathSegments: number;
    towerOverlays: number;
    campOverlays: number;
    objectiveOverlays: number;
    spatialAssertions: number;
    failedSpatialAssertions: number;
  };
}

export interface OfflineAcceptanceMetricCapture {
  ok: boolean;
  snapshot: OfflineAcceptanceMetricSnapshot | null;
  findings: string[];
}

export interface OfflineAcceptanceMetricDelta {
  metric: keyof OfflineAcceptanceMetricSnapshot["metrics"];
  previous: number;
  current: number;
  delta: number;
}

export interface OfflineAcceptanceComparison {
  comparable: true;
  acceptanceChanged: boolean;
  changedMetrics: OfflineAcceptanceMetricDelta[];
  attentionSignals: string[];
  requiresReview: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonNegativeInteger(value: unknown, path: string, findings: string[]): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    findings.push(`${path} must be a non-negative integer.`);
    return 0;
  }
  return Number(value);
}

/**
 * Reduce one large acceptance report to stable graybox-health measurements.
 * Missing evidence fails closed rather than silently becoming zero.
 */
export function captureOfflineAcceptanceMetrics(report: unknown): OfflineAcceptanceMetricCapture {
  const findings: string[] = [];
  const root = record(report);
  const stages = record(root?.stages);
  const validation = record(record(stages?.validation)?.structuredContent);
  const reachability = record(validation?.reachability);
  const validationFindings = Array.isArray(validation?.findings) ? validation.findings : undefined;
  const preview = record(record(stages?.preview)?.structuredContent);
  const previewStats = record(preview?.stats);
  const overlays = record(previewStats?.overlays);
  if (!root || typeof root.ok !== "boolean") findings.push("ok must be a boolean.");
  if (!validationFindings) findings.push("stages.validation.structuredContent.findings must be an array.");

  let warningCount = 0;
  let errorCount = 0;
  for (const finding of validationFindings ?? []) {
    const severity = record(finding)?.severity;
    if (severity === "warn") warningCount += 1;
    else if (severity === "error") errorCount += 1;
    else findings.push("Every validation finding must have severity warn or error.");
  }

  const metrics = {
    validationFindings: validationFindings?.length ?? 0,
    validationWarnings: warningCount,
    validationErrors: errorCount,
    entityCount: nonNegativeInteger(validation?.entityCount, "validation.entityCount", findings),
    requirementCount: nonNegativeInteger(validation?.requirementCount, "validation.requirementCount", findings),
    walkableCells: nonNegativeInteger(reachability?.walkableCellCount, "reachability.walkableCellCount", findings),
    reachableCells: nonNegativeInteger(reachability?.reachableCellCount, "reachability.reachableCellCount", findings),
    unreachableCells: nonNegativeInteger(reachability?.unreachableCellCount, "reachability.unreachableCellCount", findings),
    holeCells: nonNegativeInteger(reachability?.holeCellCount, "reachability.holeCellCount", findings),
    regionCount: nonNegativeInteger(reachability?.regionCount, "reachability.regionCount", findings),
    waterCells: nonNegativeInteger(previewStats?.waterCells, "preview.stats.waterCells", findings),
    cliffCells: nonNegativeInteger(previewStats?.cliffCells, "preview.stats.cliffCells", findings),
    rampCells: nonNegativeInteger(previewStats?.rampCells, "preview.stats.rampCells", findings),
    entityOverlays: nonNegativeInteger(overlays?.entities, "preview.overlays.entities", findings),
    pathSegments: nonNegativeInteger(overlays?.paths, "preview.overlays.paths", findings),
    towerOverlays: nonNegativeInteger(overlays?.towers, "preview.overlays.towers", findings),
    campOverlays: nonNegativeInteger(overlays?.camps, "preview.overlays.camps", findings),
    objectiveOverlays: nonNegativeInteger(overlays?.objectives, "preview.overlays.objectives", findings),
    spatialAssertions: nonNegativeInteger(overlays?.spatialAssertions, "preview.overlays.spatialAssertions", findings),
    failedSpatialAssertions: nonNegativeInteger(
      overlays?.failedSpatialAssertions,
      "preview.overlays.failedSpatialAssertions",
      findings,
    ),
  };
  return findings.length > 0
    ? { ok: false, snapshot: null, findings }
    : { ok: true, snapshot: { acceptancePass: Boolean(root?.ok), metrics }, findings };
}

/**
 * Compare coherent reports without deciding whether a deliberate design change is allowed.
 * Attention signals are review prompts; they do not alter acceptance by themselves.
 */
export function compareOfflineAcceptanceMetrics(
  previous: OfflineAcceptanceMetricSnapshot,
  current: OfflineAcceptanceMetricSnapshot,
): OfflineAcceptanceComparison {
  const changedMetrics: OfflineAcceptanceMetricDelta[] = [];
  for (const metric of Object.keys(current.metrics) as Array<keyof typeof current.metrics>) {
    const before = previous.metrics[metric];
    const after = current.metrics[metric];
    if (before !== after) changedMetrics.push({ metric, previous: before, current: after, delta: after - before });
  }

  const attentionSignals: string[] = [];
  const increased = (metric: keyof typeof current.metrics, label: string) => {
    const before = previous.metrics[metric];
    const after = current.metrics[metric];
    if (after > before) attentionSignals.push(`${label} increased from ${before} to ${after}.`);
  };
  const decreased = (metric: keyof typeof current.metrics, label: string) => {
    const before = previous.metrics[metric];
    const after = current.metrics[metric];
    if (after < before) attentionSignals.push(`${label} decreased from ${before} to ${after}.`);
  };
  if (previous.acceptancePass && !current.acceptancePass) attentionSignals.push("Acceptance changed from pass to fail.");
  increased("validationWarnings", "Validation warnings");
  increased("validationErrors", "Validation errors");
  increased("unreachableCells", "Unreachable cells");
  increased("holeCells", "Terrain holes");
  increased("failedSpatialAssertions", "Failed spatial assertions");
  decreased("reachableCells", "Reachable cells");
  decreased("pathSegments", "Managed path segments");
  decreased("towerOverlays", "Tower overlays");
  decreased("campOverlays", "Camp overlays");
  decreased("objectiveOverlays", "Objective overlays");

  return {
    comparable: true,
    acceptanceChanged: previous.acceptancePass !== current.acceptancePass,
    changedMetrics,
    attentionSignals,
    requiresReview: attentionSignals.length > 0,
  };
}
