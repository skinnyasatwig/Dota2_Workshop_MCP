import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readMapTransactionManifest,
  runMapTransaction,
} from "../src/dota/map-transaction.js";
import { replaceFileFromPath, writeFileAtomically } from "../src/util/file-transaction.js";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("replaceFileFromPath swaps a staged file over an existing destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-map-file-swap-"));
  try {
    const source = join(root, "source.vmap");
    const destination = join(root, "destination.vmap");
    await writeFile(source, "new map", "utf8");
    await writeFile(destination, "old map", "utf8");

    await replaceFileFromPath(source, destination);

    assert.equal(await readFile(destination, "utf8"), "new map");
    assert.equal(await readFile(source, "utf8"), "new map");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeFileAtomically replaces an existing destination without staged leftovers", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-map-atomic-write-"));
  try {
    const destination = join(root, "artifacts", "latest.json");
    await writeFileAtomically(destination, "first report");
    await writeFileAtomically(destination, Buffer.from("second report"));

    assert.equal(await readFile(destination, "utf8"), "second report");
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(join(root, "artifacts")));
    assert.deepEqual(entries, ["latest.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runMapTransaction commits changes and retains a recovery backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-map-transaction-"));
  try {
    const map = join(root, "content", "arena.vmap");
    await mkdir(join(root, "content"), { recursive: true });
    await writeFile(map, "old map", "utf8");

    const outcome = await runMapTransaction({
      projectRoot: root,
      label: "arena terrain",
      trackedPaths: [map],
      action: async () => {
        await writeFile(map, "new map", "utf8");
        return { changed: true };
      },
    });

    assert.equal(outcome.committed, true);
    assert.equal(outcome.rolledBack, false);
    assert.deepEqual(outcome.value, { changed: true });
    assert.equal(await readFile(map, "utf8"), "new map");
    const manifest = await readMapTransactionManifest(outcome.backupDirectory);
    assert.equal(manifest.status, "committed");
    assert.equal(
      await readFile(join(outcome.backupDirectory, manifest.files[0].backupFile!), "utf8"),
      "old map",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runMapTransaction restores old files and removes new files after failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-map-rollback-"));
  try {
    const map = join(root, "content", "arena.vmap");
    const compiled = join(root, "game", "arena.vpk");
    const generated = join(root, "game", "new-addoninfo.txt");
    await mkdir(join(root, "content"), { recursive: true });
    await mkdir(join(root, "game"), { recursive: true });
    await writeFile(map, "old map", "utf8");
    await writeFile(compiled, "old compiled map", "utf8");

    const outcome = await runMapTransaction({
      projectRoot: root,
      label: "arena compile",
      trackedPaths: [map, compiled, generated],
      action: async () => {
        await writeFile(map, "new map", "utf8");
        await writeFile(compiled, "broken compile", "utf8");
        await writeFile(generated, "new registration", "utf8");
        throw new Error("compiler rejected the map");
      },
    });

    assert.equal(outcome.committed, false);
    assert.equal(outcome.rolledBack, true);
    assert.match(outcome.error ?? "", /compiler rejected/);
    assert.equal(await readFile(map, "utf8"), "old map");
    assert.equal(await readFile(compiled, "utf8"), "old compiled map");
    assert.equal(await exists(generated), false);
    const manifest = await readMapTransactionManifest(outcome.backupDirectory);
    assert.equal(manifest.status, "rolled_back");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
