import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace one file without exposing a partially copied destination. The incoming
 * file is staged beside the destination, then swapped into place. If the swap
 * fails, the original destination is restored before the error is rethrown.
 */
export async function replaceFileFromPath(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const suffix = randomUUID();
  const incoming = `${destination}.${suffix}.incoming`;
  const displaced = `${destination}.${suffix}.previous`;
  await copyFile(source, incoming);

  const hadDestination = await exists(destination);
  let movedOriginal = false;
  let installedIncoming = false;
  try {
    if (hadDestination) {
      await rename(destination, displaced);
      movedOriginal = true;
    }
    await rename(incoming, destination);
    installedIncoming = true;
  } catch (cause) {
    if (installedIncoming) await rm(destination, { force: true }).catch(() => {});
    if (movedOriginal && (await exists(displaced))) {
      await rename(displaced, destination).catch(() => {});
    }
    throw cause;
  } finally {
    await rm(incoming, { force: true }).catch(() => {});
  }

  if (movedOriginal) await rm(displaced, { force: true }).catch(() => {});
}

/**
 * Write one file through a same-directory staged file and the rollback-safe
 * replacement path above. Callers never observe a partially written destination.
 */
export async function writeFileAtomically(
  destination: string,
  data: string | NodeJS.ArrayBufferView,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const staged = `${destination}.${randomUUID()}.staged`;
  try {
    await writeFile(staged, data);
    await replaceFileFromPath(staged, destination);
  } finally {
    await rm(staged, { force: true }).catch(() => {});
  }
}
