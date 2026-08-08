#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessOfflineAcceptance } from "../dist/dota/map-offline-acceptance.js";

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
  report = {
    schemaVersion: 2,
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
    artifacts: { report: reportPath, preview: previewImage ? previewPath : null },
  };
} finally {
  await client.close();
}

await mkdir(artifactDirectory, { recursive: true });
if (previewImage) await writeFile(previewPath, Buffer.from(previewImage, "base64"));
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

for (const [name, stage] of Object.entries(report.stages)) {
  if (!stage) continue;
  const firstLine = stage.text.split(/\r?\n/, 1)[0] || "no text result";
  console.log(`[${stage.isError ? "FAIL" : "PASS"}] ${name}: ${firstLine}`);
}
console.log(`Acceptance: ${report.ok ? "PASS" : "FAIL"}`);
console.log(`Report: ${reportPath}`);
if (previewImage) console.log(`Preview: ${previewPath}`);
if (!report.ok) process.exitCode = 1;
