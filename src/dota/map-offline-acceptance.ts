export interface OfflineAcceptanceCriteria {
  stagesSucceeded: boolean;
  contractIsSynchronized: boolean;
  currentSpatialRulesPass: boolean;
  desiredSpatialRulesPass: boolean;
  compilePreflightPasses: boolean;
  staticValidationPasses: boolean;
  previewSpatialRulesPass: boolean;
  previewProduced: boolean;
}

export interface OfflineAcceptanceAssessment {
  ok: boolean;
  criteria: OfflineAcceptanceCriteria;
}

export interface OfflineAcceptanceInput {
  stageErrors: {
    sync: boolean;
    compile: boolean;
    validation: boolean;
    preview: boolean;
  };
  sync: unknown;
  compilePreflight: unknown;
  validation: unknown;
  preview: unknown;
  previewProduced: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function zeroFailureSummary(value: unknown): boolean {
  const summary = record(value);
  return summary !== undefined && Number.isInteger(summary.total) && Number(summary.total) >= 0 &&
    Number.isInteger(summary.failed) && Number(summary.failed) === 0 &&
    Number.isInteger(summary.unresolved) && Number(summary.unresolved) === 0;
}

function compilePreflightPasses(value: unknown): boolean {
  const preflight = record(value);
  const materials = record(preflight?.materialValidation);
  const models = record(preflight?.modelValidation);
  const physicsValue = preflight?.modelPhysicsValidation;
  const physics = record(physicsValue);
  return preflight?.dryRun === true && materials?.safeToWrite === true && models?.safeToWrite === true &&
    (physicsValue === undefined || physicsValue === null || physics?.safeToWrite === true);
}

export function assessOfflineAcceptance(input: OfflineAcceptanceInput): OfflineAcceptanceAssessment {
  const sync = record(input.sync);
  const validation = record(input.validation);
  const preview = record(input.preview);
  const previewStats = record(preview?.stats);
  const previewOverlays = record(previewStats?.overlays);
  const criteria: OfflineAcceptanceCriteria = {
    stagesSucceeded: !input.stageErrors.sync && !input.stageErrors.compile &&
      !input.stageErrors.validation && !input.stageErrors.preview,
    contractIsSynchronized: Number.isInteger(sync?.changed) && Number(sync?.changed) === 0,
    currentSpatialRulesPass: zeroFailureSummary(sync?.currentSpatialAssertionSummary),
    desiredSpatialRulesPass: zeroFailureSummary(sync?.spatialAssertionSummary),
    compilePreflightPasses: compilePreflightPasses(input.compilePreflight),
    staticValidationPasses: validation?.ok === true,
    previewSpatialRulesPass: Number.isInteger(previewOverlays?.failedSpatialAssertions) &&
      Number(previewOverlays?.failedSpatialAssertions) === 0,
    previewProduced: input.previewProduced,
  };
  return { ok: Object.values(criteria).every(Boolean), criteria };
}
