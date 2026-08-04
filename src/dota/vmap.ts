// Programmatic Dota 2 map (.vmap) authoring. A .vmap is a DMX document; Valve's
// dmxconvert.exe converts between the binary on-disk form and a human-readable
// keyvalues2 text form. We read a map as kv2 text, edit it (add entities, etc.),
// and write it back to binary — then resourcecompiler turns it into a playable .vpk.
//
// Proven pipeline: kv2 text -> dmxconvert (binary) -> resourcecompiler (-game game/dota) -> .vpk.

import { writeFile, readFile, mkdtemp, rm, mkdir, copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { run, RunResult } from "./process.js";
import { replaceFileFromPath } from "../util/file-transaction.js";

/** Convert a binary .vmap to keyvalues2 text. */
export async function vmapToText(dmxconvert: string, vmapPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "d2vmap-"));
  const out = join(dir, "map.kv2.txt");
  try {
    const res = await run(dmxconvert, ["-i", vmapPath, "-o", out, "-oe", "keyvalues2"], { timeoutMs: 120_000 });
    if (res.code !== 0) throw new Error(`dmxconvert (to text) failed: ${res.stderr || res.stdout}`);
    return await readFile(out, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Write keyvalues2 text out as a binary .vmap. */
export async function textToVmap(dmxconvert: string, text: string, vmapPath: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "d2vmap-"));
  const inTxt = join(dir, "map.kv2.txt");
  const converted = join(dir, "map.vmap");
  try {
    await writeFile(inTxt, text, "utf8");
    await mkdir(dirname(vmapPath), { recursive: true });
    const res = await run(dmxconvert, ["-i", inTxt, "-o", converted, "-oe", "binary"], { timeoutMs: 120_000 });
    if (res.code !== 0) throw new Error(`dmxconvert (to binary) failed: ${res.stderr || res.stdout}`);
    const convertedStat = await stat(converted).catch(() => undefined);
    if (!convertedStat?.isFile() || convertedStat.size === 0) {
      throw new Error("dmxconvert reported success but did not produce a non-empty .vmap.");
    }
    await replaceFileFromPath(converted, vmapPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Clone a base .vmap to a new path (binary copy — guaranteed-valid starting point). */
export async function cloneVmap(basePath: string, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(basePath, destPath);
}

export function maxNodeId(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/"nodeID"\s+"int"\s+"(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max;
}

export interface EntitySpec {
  classname: string;
  origin?: string; // "x y z"
  angles?: string; // "pitch yaw roll"
  properties?: Record<string, string | number>;
}

export interface ParsedMapEntity {
  classname: string;
  origin?: string;
  angles?: string;
  nodeId?: number;
  targetname?: string;
  target?: string;
  properties: Record<string, string>;
}

export interface MapEntityPatch {
  targetname: string;
  classname?: string;
  newTargetname?: string;
  origin?: string;
  angles?: string;
  properties?: Record<string, string | number>;
  removeProperties?: string[];
}

export interface MapEntityPatchResult {
  text: string;
  matched: string[];
  unmatched: string[];
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Extract map entities and their string keyvalues from keyvalues2 vmap text. */
export function parseMapEntities(text: string): ParsedMapEntity[] {
  const entities: ParsedMapEntity[] = [];
  const marker = /"CMapEntity"\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    const open = text.indexOf("{", match.index);
    const close = matchingBrace(text, open);
    if (close < 0) break;
    const block = text.slice(open, close + 1);
    const properties: Record<string, string> = {};
    for (const prop of block.matchAll(/"([^"]+)"\s+"string"\s+"((?:\\.|[^"\\])*)"/g)) {
      properties[prop[1]] = prop[2];
    }
    const classname = properties.classname;
    if (classname) {
      const origin = block.match(/"origin"\s+"vector3"\s+"([^"]+)"/)?.[1];
      const angles = block.match(/"angles"\s+"qangle"\s+"([^"]+)"/)?.[1];
      const nodeText = block.match(/"nodeID"\s+"int"\s+"(\d+)"/)?.[1];
      entities.push({
        classname,
        origin,
        angles,
        nodeId: nodeText === undefined ? undefined : Number(nodeText),
        targetname: properties.targetname,
        target: properties.target,
        properties,
      });
    }
    marker.lastIndex = close + 1;
  }
  return entities;
}

export function entityBlockRanges(text: string): { start: number; end: number; block: string; entity: ParsedMapEntity }[] {
  const ranges: { start: number; end: number; block: string; entity: ParsedMapEntity }[] = [];
  const marker = /"CMapEntity"\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    const open = text.indexOf("{", match.index);
    const close = matchingBrace(text, open);
    if (close < 0) break;
    const block = text.slice(match.index, close + 1);
    const entity = parseMapEntities(block)[0];
    if (entity) ranges.push({ start: match.index, end: close + 1, block, entity });
    marker.lastIndex = close + 1;
  }
  return ranges;
}

function escapedKey(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapedDmxString(value: string | number): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function replaceTypedValue(block: string, key: string, type: string, value: string | number): string {
  const pattern = new RegExp(`("${escapedKey(key)}"\\s+"${escapedKey(type)}"\\s+")((?:\\\\.|[^"\\\\])*)(")`);
  return block.replace(pattern, (_match, prefix: string, _old: string, suffix: string) => {
    return `${prefix}${escapedDmxString(value)}${suffix}`;
  });
}

function removeStringProperty(block: string, key: string): string {
  const pattern = new RegExp(`^([\\t ]*)"${escapedKey(key)}"\\s+"string"\\s+"(?:\\\\.|[^"\\\\])*"\\s*\\r?\\n?`, "m");
  return block.replace(pattern, "");
}

function upsertStringProperty(block: string, key: string, value: string | number): string {
  const existing = new RegExp(`"${escapedKey(key)}"\\s+"string"\\s+"(?:\\\\.|[^"\\\\])*"`);
  if (existing.test(block)) return replaceTypedValue(block, key, "string", value);

  const marker = /"entity_properties"\s+"EditGameClassProps"\s*\{/g.exec(block);
  if (!marker) throw new Error("CMapEntity has no entity_properties block.");
  const open = block.indexOf("{", marker.index);
  const close = matchingBrace(block, open);
  if (close < 0) throw new Error("Malformed entity_properties block.");
  const indent = block.match(/^([\t ]*)"classname"\s+"string"/m)?.[1] ?? "\t\t";
  const line = `${indent}"${key}" "string" "${escapedDmxString(value)}"\n`;
  return block.slice(0, close) + line + block.slice(close);
}

function patchEntityBlock(block: string, patch: MapEntityPatch): string {
  let out = block;
  if (patch.classname !== undefined) out = replaceTypedValue(out, "classname", "string", patch.classname);
  if (patch.origin !== undefined) out = replaceTypedValue(out, "origin", "vector3", patch.origin);
  if (patch.angles !== undefined) out = replaceTypedValue(out, "angles", "qangle", patch.angles);
  for (const key of patch.removeProperties ?? []) out = removeStringProperty(out, key);
  if (patch.newTargetname !== undefined) out = upsertStringProperty(out, "targetname", patch.newTargetname);
  for (const [key, value] of Object.entries(patch.properties ?? {})) out = upsertStringProperty(out, key, value);
  return out;
}

/** Patch existing entities by targetname without rebuilding unrelated map data. */
export function patchMapEntities(text: string, patches: MapEntityPatch[]): MapEntityPatchResult {
  const byTargetname = new Map(patches.map((patch) => [patch.targetname, patch]));
  const matched: string[] = [];
  const replacements: { start: number; end: number; block: string }[] = [];
  for (const range of entityBlockRanges(text)) {
    if (!range.entity.targetname) continue;
    const patch = byTargetname.get(range.entity.targetname);
    if (!patch) continue;
    replacements.push({ start: range.start, end: range.end, block: patchEntityBlock(range.block, patch) });
    matched.push(range.entity.targetname);
  }

  let out = text;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, replacement.start) + replacement.block + out.slice(replacement.end);
  }
  const matchedSet = new Set(matched);
  return {
    text: out,
    matched,
    unmatched: patches.map((patch) => patch.targetname).filter((targetname) => !matchedSet.has(targetname)),
  };
}

export interface ManagedEntitySpec {
  targetname: string;
  classname: string;
  origin: string;
  angles?: string;
  properties?: Record<string, string | number>;
  removeProperties?: string[];
}

export interface ManagedAbsentEntitySpec {
  classname: string;
  targetname?: string;
  origin?: string;
  angles?: string;
}

export interface MapEntityReconcileResult {
  text: string;
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  conflicts: string[];
}

function removeEntityRanges(
  text: string,
  ranges: { start: number; end: number }[],
): string {
  let out = text;
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    let start = range.start;
    let end = range.end;
    const commaAfter = out.slice(end).match(/^\s*,/);
    if (commaAfter) {
      end += commaAfter[0].length;
    } else {
      const commaBefore = out.slice(0, start).match(/,\s*$/);
      if (commaBefore) start -= commaBefore[0].length;
    }
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}

function removeEntityBlocks(text: string, targetnames: Set<string>): string {
  const ranges = entityBlockRanges(text).filter(
    (range) => range.entity.targetname && targetnames.has(range.entity.targetname),
  );
  return removeEntityRanges(text, ranges);
}

export function absentSelectorLabel(selector: ManagedAbsentEntitySpec): string {
  return [
    selector.classname,
    selector.targetname ? `targetname=${selector.targetname}` : undefined,
    selector.origin ? `origin=${selector.origin}` : undefined,
    selector.angles ? `angles=${selector.angles}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export function matchesAbsentSelector(
  entity: ParsedMapEntity,
  selector: ManagedAbsentEntitySpec,
): boolean {
  return (
    entity.classname === selector.classname &&
    (selector.targetname === undefined || entity.targetname === selector.targetname) &&
    (selector.origin === undefined || entity.origin === selector.origin) &&
    (selector.angles === undefined || entity.angles === selector.angles)
  );
}

/** Make named entities match a desired-state contract without removing unrelated map data. */
export function reconcileMapEntities(
  text: string,
  specs: ManagedEntitySpec[],
  options: {
    prunePrefixes?: string[];
    absentEntities?: ManagedAbsentEntitySpec[];
  } = {},
): MapEntityReconcileResult {
  const parsed = parseMapEntities(text);
  const byTargetname = new Map<string, ParsedMapEntity[]>();
  for (const entity of parsed) {
    if (!entity.targetname) continue;
    const matches = byTargetname.get(entity.targetname) ?? [];
    matches.push(entity);
    byTargetname.set(entity.targetname, matches);
  }

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  const conflicts: string[] = [];
  const patches: MapEntityPatch[] = [];
  const missing: ManagedEntitySpec[] = [];

  for (const spec of specs) {
    const matches = byTargetname.get(spec.targetname) ?? [];
    if (matches.length > 1) {
      conflicts.push(spec.targetname);
      continue;
    }
    if (!matches.length) {
      missing.push(spec);
      added.push(spec.targetname);
      continue;
    }

    const current = matches[0];
    const desiredProperties = Object.fromEntries(
      Object.entries(spec.properties ?? {}).filter(([key]) => key !== "targetname"),
    );
    const removeProperties = (spec.removeProperties ?? []).filter((key) => key !== "targetname");
    const differs =
      current.classname !== spec.classname ||
      current.origin !== spec.origin ||
      (spec.angles !== undefined && current.angles !== spec.angles) ||
      Object.entries(desiredProperties).some(([key, value]) => current.properties[key] !== String(value)) ||
      removeProperties.some((key) => current.properties[key] !== undefined);
    if (!differs) {
      unchanged.push(spec.targetname);
      continue;
    }
    patches.push({
      targetname: spec.targetname,
      classname: spec.classname,
      origin: spec.origin,
      angles: spec.angles,
      properties: desiredProperties,
      removeProperties,
    });
    updated.push(spec.targetname);
  }

  let out = patches.length ? patchMapEntities(text, patches).text : text;
  const desiredNames = new Set(specs.map((spec) => spec.targetname));
  const prefixPatterns = (options.prunePrefixes ?? []).map(
    (prefix) => new RegExp(`^${escapedKey(prefix)}_\\d+$`),
  );
  const staleNames = new Set(
    parsed
      .map((entity) => entity.targetname)
      .filter(
        (targetname): targetname is string =>
          !!targetname &&
          !desiredNames.has(targetname) &&
          prefixPatterns.some((pattern) => pattern.test(targetname)),
      ),
  );
  if (staleNames.size) {
    out = removeEntityBlocks(out, staleNames);
    removed.push(...staleNames);
  }
  const absentRanges: { start: number; end: number }[] = [];
  const claimedAbsentRanges = new Set<number>();
  for (const selector of options.absentEntities ?? []) {
    const label = absentSelectorLabel(selector);
    const matches = entityBlockRanges(out).filter((range) =>
      matchesAbsentSelector(range.entity, selector),
    );
    if (matches.length > 1) {
      conflicts.push(label);
      continue;
    }
    if (!matches.length) continue;
    const match = matches[0];
    if (claimedAbsentRanges.has(match.start)) {
      conflicts.push(label);
      continue;
    }
    claimedAbsentRanges.add(match.start);
    absentRanges.push({ start: match.start, end: match.end });
    removed.push(label);
  }
  if (absentRanges.length) out = removeEntityRanges(out, absentRanges);
  let nodeId = maxNodeId(out);
  for (const spec of missing) {
    const properties = { ...(spec.properties ?? {}), targetname: spec.targetname };
    out = insertEntity(
      out,
      buildEntityBlock(
        {
          classname: spec.classname,
          origin: spec.origin,
          angles: spec.angles,
          properties,
        },
        ++nodeId,
      ),
    );
  }
  return { text: out, added, updated, removed, unchanged, conflicts };
}

export function rewriteWaypointPath(
  text: string,
  fromPrefix: string,
  toPrefix: string,
  classname = "path_corner",
  startIndex = 1,
): MapEntityPatchResult {
  const suffix = new RegExp(`^${escapedKey(fromPrefix)}(\\d+)$`);
  const waypoints = parseMapEntities(text)
    .filter((entity) => entity.targetname && suffix.test(entity.targetname))
    .sort((a, b) => Number(a.targetname!.match(suffix)![1]) - Number(b.targetname!.match(suffix)![1]));
  if (!waypoints.length) return { text, matched: [], unmatched: [fromPrefix] };

  const patches = waypoints.map((entity, offset): MapEntityPatch => {
    const next = offset < waypoints.length - 1 ? `${toPrefix}${startIndex + offset + 1}` : undefined;
    return {
      targetname: entity.targetname!,
      classname,
      newTargetname: `${toPrefix}${startIndex + offset}`,
      properties: next ? { target: next } : undefined,
      removeProperties: next
        ? ["speed", "radius", "orientationtype"]
        : ["target", "speed", "radius", "orientationtype"],
    };
  });
  return patchMapEntities(text, patches);
}

/** Build a CMapEntity keyvalues2 block (whitespace is irrelevant to dmxconvert). */
export function buildEntityBlock(spec: EntitySpec, nodeId: number): string {
  const props = spec.properties ?? {};
  const propLines = Object.entries(props)
    .map(([k, v]) => `\t\t"${escapedDmxString(k)}" "string" "${escapedDmxString(v)}"`)
    .join("\n");
  return `"CMapEntity"
{
	"id" "elementid" "${randomUUID()}"
	"origin" "vector3" "${escapedDmxString(spec.origin ?? "0 0 0")}"
	"angles" "qangle" "${escapedDmxString(spec.angles ?? "0 0 0")}"
	"scales" "vector3" "1 1 1"
	"nodeID" "int" "${nodeId}"
	"children" "element_array" [ ]
	"editorOnly" "bool" "0"
	"force_hidden" "bool" "0"
	"variableTargetKeys" "string_array" [ ]
	"variableNames" "string_array" [ ]
	"relayPlugData" "DmePlugList"
	{
		"id" "elementid" "${randomUUID()}"
		"names" "string_array" [ ]
		"dataTypes" "int_array" [ ]
		"plugTypes" "int_array" [ ]
		"descriptions" "string_array" [ ]
	}
	"connectionsData" "element_array" [ ]
	"entity_properties" "EditGameClassProps"
	{
		"id" "elementid" "${randomUUID()}"
		"classname" "string" "${escapedDmxString(spec.classname)}"
${propLines}
	}
	"hitNormal" "vector3" "0 0 1"
}
`;
}

/** Insert an entity block into the CMapWorld children array of a kv2 vmap text. */
export function insertEntity(text: string, entityBlock: string): string {
  const worldIdx = text.indexOf('"world" "CMapWorld"');
  if (worldIdx < 0) throw new Error("Could not find the CMapWorld element in this vmap.");
  const childrenIdx = text.indexOf('"children" "element_array"', worldIdx);
  if (childrenIdx < 0) throw new Error("Could not find the world children array.");
  const openBracket = text.indexOf("[", childrenIdx);
  if (openBracket < 0) throw new Error("Malformed world children array.");
  const insertAt = openBracket + 1;
  const after = text.slice(insertAt);
  // element_array entries are comma-separated (and may be inline definitions or
  // "element" "<id>" references) — add a separating comma when the array is non-empty.
  const isEmpty = /^\s*\]/.test(after);
  const sep = isEmpty ? "" : ",";
  return text.slice(0, insertAt) + "\n" + entityBlock.trimEnd() + sep + after;
}

export interface MapCompileResult extends RunResult {
  vpkPath: string;
}

/** Compile a content .vmap into a game .vpk via resourcecompiler. */
export async function compileVmap(
  resourceCompilerExe: string,
  dotaGameDir: string,
  contentVmapPath: string,
  gameMapsVpkPath: string,
  force = false,
): Promise<MapCompileResult> {
  const args = ["-v", "-nop4", "-i", contentVmapPath, "-game", dotaGameDir];
  if (force) args.splice(2, 0, "-f");
  const res = await run(resourceCompilerExe, args, { timeoutMs: 600_000 });
  return { ...res, vpkPath: gameMapsVpkPath };
}
