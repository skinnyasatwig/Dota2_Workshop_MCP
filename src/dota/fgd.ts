export interface FgdProperty {
  name: string;
  type: string;
  kind: "keyvalue" | "input" | "output";
}

export interface FgdEntity {
  name: string;
  classType: string;
  description: string;
  bases: string[];
  properties: FgdProperty[];
}

function matchingBracket(text: string, openAt: number): number {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = openAt; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseTopLevelProperties(block: string): FgdProperty[] {
  const properties: FgdProperty[] = [];
  let depth = 1;
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (depth === 1) {
      const io = line.match(/^(input|output)\s+([A-Za-z_]\w*)\s*\(\s*([^)]+?)\s*\)/i);
      if (io) {
        properties.push({
          name: io[2],
          type: io[3],
          kind: io[1].toLowerCase() as "input" | "output",
        });
      } else {
        const keyvalue = line.match(
          /^([A-Za-z_]\w*)\s*\(\s*([^)]+?)\s*\)\s*(?:(?:\{[^}]*\}|\[[^\]]*\])\s*)*:/,
        );
        if (keyvalue) {
          properties.push({
            name: keyvalue[1],
            type: keyvalue[2],
            kind: "keyvalue",
          });
        }
      }
    }
    for (const char of line) {
      if (char === "[") depth++;
      if (char === "]") depth--;
    }
  }
  return properties;
}

function classDeclaration(segment: string):
  | { name: string; start: number; end: number; open: number }
  | undefined {
  let quoted = false;
  let escaped = false;
  let braces = 0;
  let brackets = 0;
  let declaration: { name: string; start: number; end: number } | undefined;
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{") braces++;
    else if (char === "}") braces = Math.max(0, braces - 1);
    else if (char === "[") {
      if (braces === 0 && brackets === 0 && declaration) {
        return { ...declaration, open: index };
      }
      brackets++;
    } else if (char === "]") {
      brackets = Math.max(0, brackets - 1);
    } else if (char === "=" && braces === 0 && brackets === 0) {
      const match = segment.slice(index).match(/^=\s*([A-Za-z_]\w*)/);
      if (match) {
        declaration = {
          name: match[1],
          start: index,
          end: index + match[0].length,
        };
      }
    }
  }
  return undefined;
}

export function parseFgdEntities(text: string): FgdEntity[] {
  const entities: FgdEntity[] = [];
  const marker = /@(PointClass|SolidClass|BaseClass|OverrideClass)\b/g;
  const markers: { index: number; classType: string; length: number }[] = [];
  let markerMatch: RegExpExecArray | null;
  while ((markerMatch = marker.exec(text))) {
    markers.push({
      index: markerMatch.index,
      classType: markerMatch[1],
      length: markerMatch[0].length,
    });
  }
  for (let markerIndex = 0; markerIndex < markers.length; markerIndex++) {
    const current = markers[markerIndex];
    const end = markers[markerIndex + 1]?.index ?? text.length;
    const segment = text.slice(current.index, end);
    const parsedDeclaration = classDeclaration(segment);
    if (!parsedDeclaration) continue;
    const openRelative = parsedDeclaration.open;
    const header = segment.slice(0, openRelative);
    const openAt = current.index + openRelative;
    const closeAt = matchingBracket(text, openAt);
    if (closeAt < 0 || closeAt >= end) continue;
    const rawDescription = header.slice(parsedDeclaration.end).replace(/^\s*:\s*/, "").trim();
    const quotedDescription = [...rawDescription.matchAll(/"([^"]*)"/g)]
      .map((match) => match[1])
      .join(" ")
      .trim();
    const bases =
      header
        .slice(current.length, parsedDeclaration.start)
        .match(/base\s*\(([^)]*)\)/i)?.[1]
        .split(",")
        .map((base) => base.trim())
        .filter(Boolean) ?? [];
    entities.push({
      name: parsedDeclaration.name,
      classType: current.classType,
      description: quotedDescription || rawDescription.replace(/^"|"$/g, ""),
      bases,
      properties: parseTopLevelProperties(text.slice(openAt + 1, closeAt)),
    });
  }
  return entities;
}

export function categoryForFgdEntity(name: string): string {
  if (
    name.startsWith("info_player_start") ||
    name.startsWith("info_courier_spawn") ||
    name.includes("_spawner")
  ) {
    return "spawn";
  }
  if (name.startsWith("path_")) return "path";
  if (name.startsWith("trigger_")) return "trigger";
  if (name.startsWith("logic_") || name.startsWith("point_")) return "logic";
  if (name.includes("light")) return "light";
  if (name.startsWith("env_")) return "env";
  if (name.startsWith("prop_") || name === "ent_dota_tree") return "prop";
  if (name.startsWith("ent_fow_")) return "vision";
  if (name.startsWith("world_") || name.startsWith("dota_minimap_")) return "world";
  if (name.startsWith("info_")) return "marker";
  if (name.includes("particle")) return "fx";
  if (name.startsWith("npc_dota_") || name.startsWith("ent_dota_") || name.startsWith("dota_")) {
    return "dota";
  }
  return "official";
}
