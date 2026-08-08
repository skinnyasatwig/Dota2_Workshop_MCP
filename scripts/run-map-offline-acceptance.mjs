#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessOfflineAcceptance } from "../dist/dota/map-offline-acceptance.js";
import {
  describeOfflineAcceptanceArtifact,
  verifyOfflineAcceptanceArtifact,
} from "../dist/dota/map-offline-acceptance-artifacts.js";
import {
  captureOfflineAcceptanceMetrics,
  compareOfflineAcceptanceMetrics,
} from "../dist/dota/map-offline-acceptance-comparison.js";
import { writeFileAtomically } from "../dist/util/file-transaction.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(`Usage: npm run test:offline-map -- <project-root> <map> [options]

Runs contract sync preview, compiler preflight, static validation, and diagnostic map preview in one MCP session.
By default it is read-only. --compile may replace only the compiled VPK transactionally; it never writes the VMAP,
launches Dota, or opens Hammer.

Options:
  --compile              After a fully passing read-only gate, transactionally compile the VPK and revalidate freshness.
  --force                With --compile, force ResourceCompiler instead of accepting an up-to-date result.
  --require-compiled     Treat a missing or stale compiled VPK as a validation error.
  --no-model-collision   Skip installed PHYS resolution during preview (faster, less complete).
  --scale=<2..16>        Preview pixels per tile (default 8).
  --verify-only          Verify the latest report/PNG pair without running any map tools.
  --help                 Show this message.`);
  process.exit(0);
}

const positional = args.filter((argument) => !argument.startsWith("--"));
const projectRoot = resolve(positional[0] ?? ".");
const map = positional[1] ?? "three_vs_three_blockout";
const scaleArgument = args.find((argument) => argument.startsWith("--scale="));
const scale = scaleArgument ? Number(scaleArgument.slice("--scale=".length)) : 8;
if (!Number.isInteger(scale) || scale < 2 || scale > 16) {
  throw new Error("--scale must be an integer from 2 through 16.");
}
const requireCompiled = args.includes("--require-compiled");
const compileRequested = args.includes("--compile");
const forceCompile = args.includes("--force");
if (forceCompile && !compileRequested) throw new Error("--force requires --compile.");
const resolveModelCollision = !args.includes("--no-model-collision");
const artifactDirectory = join(projectRoot, "artifacts");
const safeMapName = map.replace(/[^A-Za-z0-9_.-]/g, "_");
const reportPath = join(artifactDirectory, `mcp-offline-acceptance-${safeMapName}-latest.json`);
const previewPath = join(artifactDirectory, `mcp-offline-acceptance-${safeMapName}-latest.png`);
const verifyOnly = args.includes("--verify-only");

async function inspectSavedArtifacts() {
  let saved;
  try {
    saved = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (cause) {
    return {
      ok: false,
      report: null,
      findings: [`Latest report could not be read: ${cause instanceof Error ? cause.message : String(cause)}`],
    };
  }
  const findings = [];
  if (saved.schemaVersion !== 3 && saved.schemaVersion !== 4) {
    findings.push(`Expected report schema 3 or 4, found ${saved.schemaVersion ?? "none"}.`);
  }
  if (typeof saved.artifactSetId !== "string" || saved.artifactSetId.length < 16) {
    findings.push("Report has no valid artifactSetId.");
  }
  if (resolve(saved.projectRoot ?? "") !== projectRoot) findings.push("Report belongs to a different project root.");
  if (saved.map !== map) findings.push("Report belongs to a different map.");
  if (resolve(saved.artifacts?.report ?? "") !== resolve(reportPath)) {
    findings.push("Report path does not identify this latest report.");
  }
  const savedPreviewPath = saved.artifacts?.preview;
  const savedPreviewIntegrity = saved.artifacts?.previewIntegrity;
  if (savedPreviewPath === null && savedPreviewIntegrity === null) {
    // A failed preview stage can still produce a coherent (failing) report with no PNG.
  } else if (typeof savedPreviewPath !== "string" || savedPreviewIntegrity === null) {
    findings.push("Preview path and integrity metadata must either both exist or both be null.");
  } else if (resolve(savedPreviewPath) !== resolve(previewPath)) {
    findings.push("Preview path does not identify this latest preview.");
  } else {
    try {
      const previewBytes = await readFile(previewPath);
      findings.push(...verifyOfflineAcceptanceArtifact(
        previewBytes,
        savedPreviewIntegrity,
      ).findings);
    } catch (cause) {
      findings.push(`Latest preview could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return { ok: findings.length === 0, report: saved, findings };
}

async function verifySavedArtifacts() {
  const inspection = await inspectSavedArtifacts();
  if (!inspection.ok) {
    throw new Error(`Acceptance artifact verification failed:\n- ${inspection.findings.join("\n- ")}`);
  }
  const saved = inspection.report;
  console.log(`Acceptance artifacts verified: ${saved.artifactSetId}`);
  console.log(`Report: ${reportPath}`);
  if (saved.artifacts?.preview) console.log(`Preview: ${previewPath}`);
  return saved;
}

if (verifyOnly) {
  await verifySavedArtifacts();
  process.exit(0);
}

// Capture the coherent previous pair before the new PNG is installed. It is advisory
// evidence only: a missing or corrupt baseline must not block a healthy current run.
const previousArtifactInspection = await inspectSavedArtifacts();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env },
});
const client = new Client({ name: "map-offline-acceptance-cli", version: "1.0.0" });

function stageRecord(result) {
  return {
    isError: result.isError === true,
    text: (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n"),
    structuredContent: result.structuredContent ?? null,
  };
}

async function runStage(name, arguments_) {
  try {
    return await client.callTool({ name, arguments: arguments_ }, undefined, {
      timeout: 240_000,
      maxTotalTimeout: 300_000,
    });
  } catch (cause) {
    return {
      isError: true,
      content: [{ type: "text", text: cause instanceof Error ? cause.message : String(cause) }],
    };
  }
}

let previewImage;
let report;
const artifactSetId = randomUUID();
try {
  await client.connect(transport);
  const syncResult = await runStage("map_sync_contract", { projectRoot, map, apply: false, recompile: false });
  const compilePreflightResult = await runStage("map_compile", { projectRoot, name: map, dryRun: true, force: false });
  const validationResult = await runStage("map_validate", { projectRoot, map, requireCompiled });
  const previewResult = await runStage("map_preview", {
    projectRoot,
    map,
    scale,
    resolveModelCollision,
  });
  previewImage = (previewResult.content ?? []).find(
    (item) => item.type === "image" && item.mimeType === "image/png",
  )?.data;

  const sync = stageRecord(syncResult);
  const compilePreflight = stageRecord(compilePreflightResult);
  const validation = stageRecord(validationResult);
  const preview = stageRecord(previewResult);
  const syncData = sync.structuredContent ?? {};
  const compilePreflightData = compilePreflight.structuredContent ?? {};
  const validationData = validation.structuredContent ?? {};
  const previewData = preview.structuredContent ?? {};
  const readOnlyAssessment = assessOfflineAcceptance({
    stageErrors: {
      sync: sync.isError,
      compile: compilePreflight.isError,
      validation: validation.isError,
      preview: preview.isError,
    },
    sync: syncData,
    compilePreflight: compilePreflightData,
    compileRequested: false,
    compileExecutionError: false,
    compileExecution: null,
    postCompileValidationError: false,
    postCompileValidation: null,
    validation: validationData,
    preview: previewData,
    previewProduced: typeof previewImage === "string" && previewImage.length > 0,
  });
  let compileExecutionResult;
  let postCompileValidationResult;
  if (compileRequested) {
    if (readOnlyAssessment.ok) {
      compileExecutionResult = await runStage("map_compile", {
        projectRoot,
        name: map,
        dryRun: false,
        force: forceCompile,
      });
      if (!compileExecutionResult.isError && compileExecutionResult.structuredContent?.ok === true) {
        postCompileValidationResult = await runStage("map_validate", {
          projectRoot,
          map,
          requireCompiled: true,
        });
      }
    }
    compileExecutionResult ??= {
      isError: true,
      content: [{ type: "text", text: "Compilation skipped because the read-only acceptance gate did not pass." }],
    };
    postCompileValidationResult ??= {
      isError: true,
      content: [{ type: "text", text: "Post-compile validation skipped because no committed compile was produced." }],
    };
  }
  const compileExecution = compileExecutionResult ? stageRecord(compileExecutionResult) : null;
  const postCompileValidation = postCompileValidationResult ? stageRecord(postCompileValidationResult) : null;
  const assessment = assessOfflineAcceptance({
    stageErrors: {
      sync: sync.isError,
      compile: compilePreflight.isError,
      validation: validation.isError,
      preview: preview.isError,
    },
    sync: syncData,
    compilePreflight: compilePreflightData,
    compileRequested,
    compileExecutionError: compileExecution?.isError ?? false,
    compileExecution: compileExecution?.structuredContent ?? null,
    postCompileValidationError: postCompileValidation?.isError ?? false,
    postCompileValidation: postCompileValidation?.structuredContent ?? null,
    validation: validationData,
    preview: previewData,
    previewProduced: typeof previewImage === "string" && previewImage.length > 0,
  });
  const reportCore = {
    schemaVersion: 4,
    artifactSetId,
    generatedAt: new Date().toISOString(),
    projectRoot,
    map,
    mode: compileRequested ? "offline-no-engine-transactional-vpk-compile" : "offline-no-engine-no-map-writes",
    requireCompiled,
    compileRequested,
    forceCompile,
    resolveModelCollision,
    scale,
    ok: assessment.ok,
    criteria: assessment.criteria,
    stages: { sync, compilePreflight, validation, preview, compileExecution, postCompileValidation },
  };
  const metricCapture = captureOfflineAcceptanceMetrics(reportCore);
  const previousMetricCapture = previousArtifactInspection.ok
    ? captureOfflineAcceptanceMetrics(previousArtifactInspection.report)
    : null;
  const previousComparison = metricCapture.snapshot && previousMetricCapture?.snapshot
    ? compareOfflineAcceptanceMetrics(previousMetricCapture.snapshot, metricCapture.snapshot)
    : null;
  report = {
    ...reportCore,
    ok: assessment.ok && metricCapture.ok,
    criteria: { ...assessment.criteria, metricSnapshotProduced: metricCapture.ok },
    metricSnapshot: metricCapture.snapshot,
    metricFindings: metricCapture.findings,
    previousRun: {
      available: previousArtifactInspection.ok && previousMetricCapture?.ok === true,
      artifactSetId: previousArtifactInspection.ok
        ? previousArtifactInspection.report?.artifactSetId ?? null
        : null,
      comparison: previousComparison,
      findings: previousArtifactInspection.ok
        ? previousMetricCapture?.findings ?? []
        : previousArtifactInspection.findings,
    },
    artifacts: {
      report: reportPath,
      preview: previewImage ? previewPath : null,
      previewIntegrity: previewImage
        ? describeOfflineAcceptanceArtifact(Buffer.from(previewImage, "base64"))
        : null,
    },
  };
} finally {
  await client.close();
}

if (!report) throw new Error("Offline acceptance ended before a report could be assembled.");
await mkdir(artifactDirectory, { recursive: true });
if (previewImage) {
  await writeFileAtomically(previewPath, Buffer.from(previewImage, "base64"));
  const savedPreview = await readFile(previewPath);
  const verification = verifyOfflineAcceptanceArtifact(savedPreview, report.artifacts.previewIntegrity);
  if (!verification.ok) throw new Error(`Saved preview verification failed:\n- ${verification.findings.join("\n- ")}`);
}
await writeFileAtomically(reportPath, JSON.stringify(report, null, 2) + "\n");
await verifySavedArtifacts();

for (const [name, stage] of Object.entries(report.stages)) {
  if (!stage) continue;
  const firstLine = stage.text.split(/\r?\n/, 1)[0] || "no text result";
  console.log(`[${stage.isError ? "FAIL" : "PASS"}] ${name}: ${firstLine}`);
}
const comparison = report.previousRun.comparison;
if (comparison) {
  console.log(
    `Previous run: ${comparison.changedMetrics.length} metric change(s), ` +
    `${comparison.attentionSignals.length} review signal(s).`,
  );
  for (const signal of comparison.attentionSignals) console.log(`  REVIEW: ${signal}`);
} else {
  console.log(`Previous run: no coherent comparable baseline (${report.previousRun.findings.join("; ") || "none saved"}).`);
}
console.log(`Acceptance: ${report.ok ? "PASS" : "FAIL"}`);
console.log(`Report: ${reportPath}`);
if (previewImage) console.log(`Preview: ${previewPath}`);
if (!report.ok) process.exitCode = 1;
