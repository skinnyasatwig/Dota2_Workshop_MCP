// Read and update Dota addoninfo.txt files.
//
// Workshop Tools currently creates KV3 addoninfo files, while the long-lived
// addon_template still uses KeyValues 1. Map tools need to support both without
// converting the user's file to a different format.

import { parseKV, serializeKV, getWrapperBlock, findPair, upsertPair, objectToBlock, isBlock } from "../kv/index.js";
import { pathExists, readTextFile, writeTextFile } from "../util/fsx.js";

export type AddonInfoFormat = "kv1" | "kv3";

export interface AddonInfoSummary {
  format: AddonInfoFormat;
  maps: string[];
  defaultMap?: string;
  maxPlayers?: number;
}

const KV3_HEADER_RE = /^\s*(?:\uFEFF)?<!--\s*kv3\b/i;
const MAP_NAME_RE = /^[a-z][a-z0-9_]+$/;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function unescapeKv3String(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseKv3StringList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === "null") return [];
  if (trimmed.startsWith("[")) {
    return unique(
      [...trimmed.matchAll(/"((?:\\.|[^"\\])*)"/g)]
        .map((m) => unescapeKv3String(m[1]))
        .filter((name) => MAP_NAME_RE.test(name)),
    );
  }
  const quoted = trimmed.match(/^"((?:\\.|[^"\\])*)"$/);
  if (quoted) return unique(unescapeKv3String(quoted[1]).split(/\s+/).filter((name) => MAP_NAME_RE.test(name)));
  return [];
}

function kv3Assignment(text: string, key: string): { value: string; start: number; end: number } | undefined {
  const keyRe = new RegExp(`(^|\\n)([\\t ]*)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*`, "g");
  const match = keyRe.exec(text);
  if (!match) return undefined;

  const start = match.index + match[1].length;
  const valueStart = keyRe.lastIndex;
  let i = valueStart;
  if (text[i] === "[") {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth++;
      else if (ch === "]" && --depth === 0) {
        i++;
        break;
      }
    }
  } else if (text[i] === '"') {
    i++;
    let escaped = false;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        i++;
        break;
      }
    }
  } else {
    while (i < text.length && text[i] !== "\r" && text[i] !== "\n") i++;
  }
  return { value: text.slice(valueStart, i).trim(), start, end: i };
}

function kv3Scalar(text: string, key: string): string | undefined {
  const assignment = kv3Assignment(text, key);
  if (!assignment) return undefined;
  const quoted = assignment.value.match(/^"((?:\\.|[^"\\])*)"$/);
  return quoted ? unescapeKv3String(quoted[1]) : assignment.value;
}

function replaceKv3Assignment(text: string, key: string, value: string): string {
  const assignment = kv3Assignment(text, key);
  if (assignment) {
    const indent = text.slice(assignment.start).match(/^[\t ]*/)?.[0] ?? "\t";
    return text.slice(0, assignment.start) + `${indent}${key} = ${value}` + text.slice(assignment.end);
  }

  const rootOpen = text.indexOf("{");
  if (rootOpen < 0) throw new Error("KV3 addoninfo.txt has no root object.");
  return text.slice(0, rootOpen + 1) + `\n\t${key} = ${value}` + text.slice(rootOpen + 1);
}

function formatKv3String(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatKv3Maps(maps: string[]): string {
  if (!maps.length) return "null";
  return `[\n${maps.map((name) => `\t\t${formatKv3String(name)},`).join("\n")}\n\t]`;
}

export function parseAddonInfo(text: string): AddonInfoSummary {
  if (KV3_HEADER_RE.test(text)) {
    const mapsAssignment = kv3Assignment(text, "maps");
    const maxPlayersText = kv3Scalar(text, "MaxPlayers");
    const parsedMaxPlayers = maxPlayersText === undefined ? undefined : Number(maxPlayersText);
    const defaultMap = kv3Scalar(text, "DefaultMap");
    return {
      format: "kv3",
      maps: mapsAssignment ? parseKv3StringList(mapsAssignment.value) : [],
      defaultMap: defaultMap && defaultMap !== "null" ? defaultMap : undefined,
      maxPlayers: Number.isFinite(parsedMaxPlayers) ? parsedMaxPlayers : undefined,
    };
  }

  const wrapper = getWrapperBlock(parseKV(text));
  if (!wrapper) throw new Error("KV1 addoninfo.txt has no AddonInfo wrapper.");
  const mapsPair = findPair(wrapper, "maps");
  const current = mapsPair && !isBlock(mapsPair.value) ? String(mapsPair.value) : "";
  const defaultPair = findPair(wrapper, "DefaultMap");
  const maxPair = findPair(wrapper, "MaxPlayers");
  const maxPlayers = maxPair && !isBlock(maxPair.value) ? Number(maxPair.value) : undefined;
  return {
    format: "kv1",
    maps: unique(current.split(/\s+/).filter((name) => MAP_NAME_RE.test(name))),
    defaultMap: defaultPair && !isBlock(defaultPair.value) && defaultPair.value ? String(defaultPair.value) : undefined,
    maxPlayers: Number.isFinite(maxPlayers) ? maxPlayers : undefined,
  };
}

export function registerMapInAddonInfo(text: string, name: string, maxPlayers: number): string {
  if (!MAP_NAME_RE.test(name)) throw new Error(`Invalid map name "${name}".`);

  if (KV3_HEADER_RE.test(text)) {
    const summary = parseAddonInfo(text);
    const maps = summary.maps.includes(name) ? summary.maps : [...summary.maps, name];
    let out = replaceKv3Assignment(text, "maps", formatKv3Maps(maps));
    out = replaceKv3Assignment(out, "IsPlayable", "true");
    out = replaceKv3Assignment(out, "MaxPlayers", String(maxPlayers));
    if (!summary.defaultMap) out = replaceKv3Assignment(out, "DefaultMap", formatKv3String(name));
    return out;
  }

  const doc = parseKV(text);
  const wrapper = getWrapperBlock(doc);
  if (!wrapper) throw new Error("KV1 addoninfo.txt has no AddonInfo wrapper.");
  const mapsPair = findPair(wrapper, "maps");
  const current = mapsPair && !isBlock(mapsPair.value) ? String(mapsPair.value) : "";
  const maps = unique(current.split(/\s+/).filter((map) => MAP_NAME_RE.test(map)));
  if (!maps.includes(name)) maps.push(name);
  upsertPair(wrapper, "maps", maps.join(" "));
  if (!findPair(wrapper, name)) upsertPair(wrapper, name, objectToBlock({ MaxPlayers: String(maxPlayers) }));
  return serializeKV(doc);
}

export async function readAddonInfo(path: string): Promise<AddonInfoSummary> {
  return parseAddonInfo((await readTextFile(path)).text);
}

export async function registerMapFile(path: string, name: string, maxPlayers: number): Promise<AddonInfoSummary> {
  const existing = (await pathExists(path))
    ? await readTextFile(path)
    : {
        text: `"AddonInfo"\n{\n\t"maps" ""\n\t"IsPlayable" "1"\n}\n`,
        encoding: "utf8" as const,
        hadBom: false,
      };
  const updated = registerMapInAddonInfo(existing.text, name, maxPlayers);
  await writeTextFile(path, updated, { encoding: existing.encoding, bom: existing.hadBom });
  return parseAddonInfo(updated);
}
