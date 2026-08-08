import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { replaceFileFromPath } from "../util/file-transaction.js";

interface FileSnapshot {
  path: string;
  existed: boolean;
  backupFile?: string;
}

interface TransactionManifest {
  label: string;
  createdAt: string;
  completedAt?: string;
  status: "running" | "committed" | "rolled_back" | "rollback_failed";
  error?: string;
  files: FileSnapshot[];
  rollbackErrors?: string[];
}

export interface MapTransactionOutcome<T> {
  committed: boolean;
  rolledBack: boolean;
  backupDirectory: string;
  value?: T;
  error?: string;
  rollbackErrors: string[];
}

export interface MapTransactionOptions<T> {
  projectRoot: string;
  label: string;
  trackedPaths: string[];
  action: () => Promise<T>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function safeLabel(label: string): string {
  const normalized = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "map-change";
}

async function writeManifest(directory: string, manifest: TransactionManifest): Promise<void> {
  await writeFile(join(directory, "transaction.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

/**
 * Snapshot all files touched by a map operation, run it, and restore every
 * snapshot if any step (including compilation) fails. Backups remain available
 * under .dota-workshop/backups after successful operations as well.
 */
export async function runMapTransaction<T>(
  options: MapTransactionOptions<T>,
): Promise<MapTransactionOutcome<T>> {
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const directory = join(
    options.projectRoot,
    ".dota-workshop",
    "backups",
    safeLabel(options.label),
    `${stamp}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(directory, { recursive: true });

  const uniquePaths = [...new Set(options.trackedPaths)];
  const snapshots: FileSnapshot[] = [];
  for (const [index, path] of uniquePaths.entries()) {
    const existed = await exists(path);
    const backupFile = existed ? `${index}-${basename(path)}` : undefined;
    if (backupFile) await copyFile(path, join(directory, backupFile));
    snapshots.push({ path, existed, backupFile });
  }

  const manifest: TransactionManifest = {
    label: options.label,
    createdAt,
    status: "running",
    files: snapshots,
  };
  await writeManifest(directory, manifest);

  try {
    const value = await options.action();
    manifest.status = "committed";
    manifest.completedAt = new Date().toISOString();
    await writeManifest(directory, manifest);
    return {
      committed: true,
      rolledBack: false,
      backupDirectory: directory,
      value,
      rollbackErrors: [],
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const rollbackErrors: string[] = [];
    for (const snapshot of [...snapshots].reverse()) {
      try {
        if (snapshot.existed && snapshot.backupFile) {
          await replaceFileFromPath(join(directory, snapshot.backupFile), snapshot.path);
        } else {
          await rm(snapshot.path, { force: true });
        }
      } catch (rollbackCause) {
        rollbackErrors.push(
          `${snapshot.path}: ${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`,
        );
      }
    }

    manifest.status = rollbackErrors.length ? "rollback_failed" : "rolled_back";
    manifest.completedAt = new Date().toISOString();
    manifest.error = message;
    manifest.rollbackErrors = rollbackErrors;
    await writeManifest(directory, manifest).catch(() => {});
    return {
      committed: false,
      rolledBack: rollbackErrors.length === 0,
      backupDirectory: directory,
      error: message,
      rollbackErrors,
    };
  }
}

/** Read a transaction manifest for diagnostics and tests. */
export async function readMapTransactionManifest(directory: string): Promise<TransactionManifest> {
  return JSON.parse(await readFile(join(directory, "transaction.json"), "utf8")) as TransactionManifest;
}
