#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipeRefreshReport, RecipeRefreshEvidence } from "../src/dota/recipe-refresh.js";
import { resolveDotaPaths } from "../src/dota/paths.js";
import { verifyInstalledRecipeVersion } from "../src/dota/recipe-version.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

function valueAfter(flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (argv.includes("--help")) {
  console.log(`Usage: npm run recipe:refresh-report -- [options]

Options:
  --run-safe-checks             Run build, tests, MCP smoke, and compiler fixture.
  --acceptance-evidence <file>  Read a reviewed acceptance-map evidence JSON object.
  --output <file>               Also write the complete JSON report to this path.
  --help                        Show this help.

This command never edits RECIPE_VERIFICATION_BASELINE.`);
  process.exit(0);
}

interface CommandResult {
  code: number;
  output: string;
}

async function runNode(label: string, args: string[]): Promise<CommandResult> {
  console.error(`[recipe refresh] ${label}...`);
  return await new Promise((resolveResult) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 16_000) output = output.slice(-16_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => resolveResult({ code: 1, output: error.message }));
    child.on("exit", (code) => resolveResult({ code: code ?? 1, output: output.trim() }));
  });
}

function evidenceFromResult(
  id: RecipeRefreshEvidence["id"],
  command: string,
  result: CommandResult,
): RecipeRefreshEvidence {
  const lastLines = result.output.split(/\r?\n/).slice(-12).join("\n");
  return {
    id,
    status: result.code === 0 ? "passed" : "failed",
    command,
    detail: lastLines || `Exited with code ${result.code}.`,
    observedAt: new Date().toISOString(),
  };
}

async function loadAcceptanceEvidence(path: string): Promise<RecipeRefreshEvidence> {
  const raw = JSON.parse(await readFile(resolve(path), "utf8")) as Partial<RecipeRefreshEvidence>;
  if (raw.status !== "passed" && raw.status !== "failed" && raw.status !== "skipped") {
    throw new Error("Acceptance evidence status must be passed, failed, or skipped.");
  }
  return {
    id: "acceptance-map",
    status: raw.status,
    command: raw.command,
    detail: raw.detail,
    observedAt: raw.observedAt,
  };
}

const dota = await resolveDotaPaths();
if (!dota) throw new Error("Dota 2 was not found. Set DOTA2_PATH to the 'dota 2 beta' folder.");

const evidence: RecipeRefreshEvidence[] = [];
let safeCheckFailed = false;
if (argv.includes("--run-safe-checks")) {
  const build = await runNode("TypeScript build", [join(root, "node_modules", "typescript", "bin", "tsc")]);
  evidence.push(evidenceFromResult("typescript-build", "npm run build", build));
  safeCheckFailed ||= build.code !== 0;

  const testFiles = (await readdir(join(root, "test")))
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => join(root, "test", name));
  const tests = await runNode("unit and integration tests", ["--import", "tsx", "--test", ...testFiles]);
  evidence.push(evidenceFromResult("unit-tests", "npm test", tests));
  safeCheckFailed ||= tests.code !== 0;

  if (build.code === 0) {
    const smoke = await runNode("MCP smoke suite", [join(root, "scripts", "smoke.mjs")]);
    evidence.push(evidenceFromResult("mcp-smoke", "npm run smoke", smoke));
    safeCheckFailed ||= smoke.code !== 0;
  } else {
    evidence.push({
      id: "mcp-smoke",
      status: "skipped",
      command: "npm run smoke",
      detail: "Skipped because the TypeScript build failed; smoke must exercise fresh dist output.",
      observedAt: new Date().toISOString(),
    });
  }

  const compiler = await runNode("repository compiler fixture", [join(root, "scripts", "test-compiler-fixture.mjs")]);
  evidence.push(evidenceFromResult("compiler-fixture", "npm run test:compiler-fixture", compiler));
  safeCheckFailed ||= compiler.code !== 0;
}

const acceptancePath = valueAfter("--acceptance-evidence");
if (acceptancePath) evidence.push(await loadAcceptanceEvidence(acceptancePath));

const verification = await verifyInstalledRecipeVersion(dota);
const report = buildRecipeRefreshReport(verification, evidence);
const json = JSON.stringify(report, null, 2) + "\n";
const outputPath = valueAfter("--output");
if (outputPath) {
  const absolute = resolve(outputPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, json, "utf8");
  console.error(`[recipe refresh] wrote ${absolute}`);
}
console.log(json.trimEnd());
if (safeCheckFailed) process.exitCode = 1;
