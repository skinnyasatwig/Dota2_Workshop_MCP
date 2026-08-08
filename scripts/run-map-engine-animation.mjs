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
const attachFrames = args.includes("--attach-frames");
const replaceRunningDota = args.includes("--replace-running-dota");
const option = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const positional = args.filter((argument) => !argument.startsWith("--"));
if (positional.length < 3) {
  throw new Error(
    "Usage: run-map-engine-animation.mjs <projectRoot> <map> <targetName> " +
    "--frame=<distance,yaw,pitch,heightOffset> [--pixel=none|warm] [--region=x,y,width,height] [--apply]",
  );
}
const projectRoot = resolve(positional[0]);
const map = positional[1];
const targetName = positional[2];
const frameValues = (option("--frame") ?? "").split(",").map(Number);
if (frameValues.length !== 4 || frameValues.some((value) => !Number.isFinite(value))) {
  throw new Error("--frame must provide four comma-separated numbers: distance,yaw,pitch,heightOffset.");
}
const pixelCheck = option("--pixel") ?? "none";
if (!new Set(["none", "warm"]).has(pixelCheck)) throw new Error("--pixel must be none or warm.");
const regionValue = option("--region");
const regionValues = regionValue?.split(",").map(Number);
if (regionValues && (regionValues.length !== 4 || regionValues.some((value) => !Number.isFinite(value)))) {
  throw new Error("--region must provide four comma-separated numbers: x,y,width,height.");
}
const artifactDirectory = join(projectRoot, "artifacts");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env },
});
const client = new Client({ name: "map-engine-animation-cli", version: "1.0.0" });

try {
  await client.connect(transport);
  const result = await client.callTool(
    {
      name: "map_engine_animation_test",
      arguments: {
        projectRoot,
        map,
        targetName,
        frame: {
          distance: frameValues[0],
          yaw: frameValues[1],
          pitch: frameValues[2],
          heightOffset: frameValues[3],
        },
        frameRegion: regionValues ? {
          x: regionValues[0],
          y: regionValues[1],
          width: regionValues[2],
          height: regionValues[3],
        } : undefined,
        pixelCheck,
        compile,
        ensureDebugSdk,
        attachFrames,
        replaceRunningDota,
        dryRun: !apply,
        launchStrategy: "steam",
      },
    },
    undefined,
    { timeout: 420_000, maxTotalTimeout: 600_000 },
  );
  const textItems = (result.content ?? []).filter((entry) => entry.type === "text");
  const imageItems = (result.content ?? []).filter((entry) => entry.type === "image");
  for (const item of textItems) console.log(item.text);
  if (result.structuredContent) {
    await mkdir(artifactDirectory, { recursive: true });
    const safeTarget = targetName.replace(/[^A-Za-z0-9_.-]/g, "_");
    const reportPath = join(artifactDirectory, `mcp-engine-animation-${map}-${safeTarget}-latest.json`);
    await writeFile(reportPath, JSON.stringify(result.structuredContent, null, 2) + "\n", "utf8");
    console.log(`Structured report: ${reportPath}`);
  }
  if (imageItems.length) {
    await mkdir(artifactDirectory, { recursive: true });
    const safeTarget = targetName.replace(/[^A-Za-z0-9_.-]/g, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const [index, item] of imageItems.entries()) {
      const path = join(artifactDirectory, `mcp-engine-animation-${map}-${safeTarget}-${stamp}-${index + 1}.png`);
      await writeFile(path, Buffer.from(item.data, "base64"));
      console.log(`Frame: ${path}`);
    }
  }
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
