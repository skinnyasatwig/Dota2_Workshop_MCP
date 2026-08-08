import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  convertImageFileToPng,
  inspectWindowCapturePng,
  WindowCaptureQuality,
} from "./capture.js";
import { ensureDir } from "../util/fsx.js";
import { decodePng } from "../util/imgmontage.js";

export interface JpegDimensions {
  width: number;
  height: number;
}

export interface EngineScreenshotResult {
  buf?: Buffer;
  method: "engine";
  command: string;
  commandOutput?: string[];
  sourceFormat: EngineScreenshotFormat;
  sourcePath?: string;
  sourceName?: string;
  sourceBytes?: number;
  dimensions?: JpegDimensions;
  quality?: WindowCaptureQuality;
  elapsedMs: number;
  retained: boolean;
  correlated: boolean;
  error?: string;
}

export interface CaptureEngineScreenshotOptions {
  screenshotsDir: string;
  sendCommand: (command: string) => void | string[] | Promise<void | string[]>;
  format?: EngineScreenshotFormat;
  quality?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stablePolls?: number;
  convertToPng?: (sourcePath: string) => Promise<Buffer>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export type EngineScreenshotFormat = "png" | "jpeg";

interface CandidateState {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  stableCount: number;
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

/** Parse JPEG dimensions without trusting the filename or invoking a decoder. */
export function inspectJpeg(buf: Buffer): JpegDimensions {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error("Engine screenshot is not a JPEG (missing SOI marker).");
  }
  let offset = 2;
  while (offset + 3 < buf.length) {
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    if (offset >= buf.length) break;
    const marker = buf[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= buf.length) break;
    const segmentLength = buf.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buf.length) {
      throw new Error("Engine screenshot JPEG has a truncated marker segment.");
    }
    if (SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new Error("Engine screenshot JPEG has an invalid SOF segment.");
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      if (width <= 0 || height <= 0) throw new Error("Engine screenshot JPEG has invalid dimensions.");
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new Error("Engine screenshot JPEG has no supported frame header.");
}

function insideDirectory(directory: string, candidate: string): boolean {
  const rel = relative(resolve(directory), resolve(candidate));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function listImages(
  directory: string,
  format: EngineScreenshotFormat,
): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const files = new Map<string, { size: number; mtimeMs: number }>();
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    const extension = extname(name).toLowerCase();
    const accepted = format === "png" ? extension === ".png" : extension === ".jpg" || extension === ".jpeg";
    if (!accepted || basename(name) !== name) continue;
    const path = join(directory, name);
    if (!insideDirectory(directory, path)) continue;
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile()) files.set(name, { size: info.size, mtimeMs: info.mtimeMs });
  }
  return files;
}

/**
 * Ask Dota's renderer for one PNG (default) or JPEG and return a checked PNG.
 *
 * Correlation is deliberately strict: only a filename absent before the command is accepted.
 * The original Dota screenshot is retained, and pre-existing files are never modified or removed.
 */
export async function captureEngineScreenshot(
  options: CaptureEngineScreenshotOptions,
): Promise<EngineScreenshotResult> {
  const format = options.format ?? "png";
  const quality = options.quality ?? 90;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("Engine screenshot quality must be an integer from 1 through 100.");
  }
  const timeoutMs = options.timeoutMs ?? 5000;
  const pollIntervalMs = options.pollIntervalMs ?? 125;
  const stablePolls = options.stablePolls ?? 2;
  if (timeoutMs <= 0 || pollIntervalMs <= 0 || stablePolls < 1) {
    throw new Error("Engine screenshot polling limits must be positive.");
  }
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds)));
  const now = options.now ?? Date.now;
  const startedAt = now();
  const command = format === "png" ? "png_screenshot" : `jpeg_screenshot \"\" ${quality}`;
  await ensureDir(options.screenshotsDir);
  const before = await listImages(options.screenshotsDir, format);
  const commandOutput = await options.sendCommand(command);

  let candidate: CandidateState | undefined;
  while (now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs);
    const after = await listImages(options.screenshotsDir, format);
    const newFiles = [...after.entries()]
      .filter(([name, info]) => !before.has(name) && info.size > 0)
      .sort((a, b) => b[1].mtimeMs - a[1].mtimeMs || a[0].localeCompare(b[0]));
    if (!newFiles.length) continue;
    const [name, info] = newFiles[0];
    const path = join(options.screenshotsDir, name);
    if (!insideDirectory(options.screenshotsDir, path)) continue;
    if (candidate?.name === name && candidate.size === info.size && candidate.mtimeMs === info.mtimeMs) {
      candidate.stableCount++;
    } else {
      candidate = { name, path, size: info.size, mtimeMs: info.mtimeMs, stableCount: 1 };
    }
    if (candidate.stableCount < stablePolls) continue;

    try {
      const source = await readFile(candidate.path);
      const dimensions = format === "png"
        ? (() => {
            const decoded = decodePng(source);
            return { width: decoded.width, height: decoded.height };
          })()
        : inspectJpeg(source);
      const png = format === "png" ? source : await (options.convertToPng ?? convertImageFileToPng)(candidate.path);
      const frameQuality = inspectWindowCapturePng(png);
      if (!frameQuality.informative) {
        return {
          method: "engine",
          command,
          commandOutput: commandOutput ?? undefined,
          sourceFormat: format,
          sourcePath: candidate.path,
          sourceName: candidate.name,
          sourceBytes: source.length,
          dimensions,
          quality: frameQuality,
          elapsedMs: now() - startedAt,
          retained: true,
          correlated: true,
          error:
            `Dota created a correlated but uninformative frame (luma range ${frameQuality.lumaRange}, ` +
            `standard deviation ${frameQuality.lumaStd.toFixed(1)}, non-black ${(frameQuality.nonBlackFraction * 100).toFixed(1)}%).`,
        };
      }
      return {
        buf: png,
        method: "engine",
        command,
        commandOutput: commandOutput ?? undefined,
        sourceFormat: format,
        sourcePath: candidate.path,
        sourceName: candidate.name,
        sourceBytes: source.length,
        dimensions,
        quality: frameQuality,
        elapsedMs: now() - startedAt,
        retained: true,
        correlated: true,
      };
    } catch (caught) {
      return {
        method: "engine",
        command,
        commandOutput: commandOutput ?? undefined,
        sourceFormat: format,
        sourcePath: candidate.path,
        sourceName: candidate.name,
        sourceBytes: candidate.size,
        elapsedMs: now() - startedAt,
        retained: true,
        correlated: true,
        error: caught instanceof Error ? caught.message : String(caught),
      };
    }
  }

  return {
    method: "engine",
    command,
    commandOutput: commandOutput ?? undefined,
    sourceFormat: format,
    elapsedMs: now() - startedAt,
    retained: true,
    correlated: false,
    error: `Dota did not create a new stable ${format.toUpperCase()} in ${options.screenshotsDir} within ${timeoutMs}ms.`,
  };
}
