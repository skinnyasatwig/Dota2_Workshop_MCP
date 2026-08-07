#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const compile = !args.includes("--no-compile");
const ensureDebugSdk = !args.includes("--no-attach");
const replaceRunningDota = args.includes("--replace-running-dota");
const mode = args.includes("--segments")
  ? "segments"
  : args.includes("--endpoints")
    ? "endpoints"
    : "both";
const positional = args.filter((argument) => !argument.startsWith("--"));
const projectRoot = resolve(positional[0] ?? ".");
const map = positional[1] ?? "three_vs_three_blockout";
const artifactDirectory = join(projectRoot, "artifacts");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env },
});
const client = new Client({ name: "map-engine-nav-cli", version: "1.0.0" });

try {
  await client.connect(transport);
  const result = await client.callTool(
    {
      name: "map_engine_nav_test",
      arguments: {
        projectRoot,
        map,
        mode,
        dryRun: !apply,
        compile,
        ensureDebugSdk,
        replaceRunningDota,
        launchStrategy: "steam",
      },
    },
    undefined,
    { timeout: 420_000, maxTotalTimeout: 600_000 },
  );
  for (const item of (result.content ?? []).filter((item) => item.type === "text")) {
    console.log(item.text);
  }
  if (result.structuredContent) {
    await mkdir(artifactDirectory, { recursive: true });
    const reportPath = join(artifactDirectory, `mcp-engine-nav-${map}-latest.json`);
    await writeFile(reportPath, JSON.stringify(result.structuredContent, null, 2) + "\n", "utf8");
    console.log(`Structured report: ${reportPath}`);
  }
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
