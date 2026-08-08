import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectProjectLink } from "../src/dota/project-link.js";

async function freshRoot(name: string): Promise<string> {
  const root = join(tmpdir(), name);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
}

test("inspectProjectLink distinguishes linked, ready, conflict, and missing source", async () => {
  const root = await freshRoot("mcp-project-link");
  const source = join(root, "source");
  const conflict = join(root, "conflict");
  await mkdir(source);
  await mkdir(conflict);

  assert.equal((await inspectProjectLink(source, source)).state, "linked");
  assert.equal((await inspectProjectLink(source, join(root, "free"))).state, "ready");
  assert.equal((await inspectProjectLink(source, conflict)).state, "conflict");
  assert.equal((await inspectProjectLink(join(root, "missing"), join(root, "elsewhere"))).state, "source-missing");
  await rm(root, { recursive: true, force: true });
});
