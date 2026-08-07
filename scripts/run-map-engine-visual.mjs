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
const captureScreenshots = args.includes("--screenshots");
const positional = args.filter((argument) => !argument.startsWith("--"));
const projectRoot = resolve(positional[0] ?? ".");
const map = positional[1] ?? "three_vs_three_blockout";
const artifactDirectory = join(projectRoot, "artifacts");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env },
});
const client = new Client({ name: "map-engine-visual-cli", version: "1.0.0" });

try {
  await client.connect(transport);
  const result = await client.callTool(
    {
      name: "map_engine_visual_test",
      arguments: {
        projectRoot,
        map,
        dryRun: !apply,
        compile,
        ensureDebugSdk,
        captureScreenshots,
        launchStrategy: "steam",
      },
    },
    undefined,
    { timeout: 420_000, maxTotalTimeout: 600_000 },
  );
  const texts = (result.content ?? []).filter((item) => item.type === "text");
  for (const item of texts) console.log(item.text);
  const images = (result.content ?? []).filter((item) => item.type === "image");
  if (result.structuredContent) {
    await mkdir(artifactDirectory, { recursive: true });
    const reportPath = join(artifactDirectory, `mcp-engine-visual-${map}-latest.json`);
    await writeFile(reportPath, JSON.stringify(result.structuredContent, null, 2) + "\n", "utf8");
    console.log(`Structured report: ${reportPath}`);
  }
  if (images.length) {
    await mkdir(artifactDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const [index, image] of images.entries()) {
      const path = join(artifactDirectory, `mcp-engine-visual-${map}-${stamp}-${index + 1}.png`);
      await writeFile(path, Buffer.from(image.data, "base64"));
      console.log(`Screenshot: ${path}`);
    }
  }
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
