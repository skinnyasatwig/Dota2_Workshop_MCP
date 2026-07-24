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
        const keyvalue = line.match(/^([A-Za-z_]\w*)\s*\(\s*([^)]+?)\s*\)\s*:/);
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

export function parseFgdEntities(text: string): FgdEntity[] {
  const entities: FgdEntity[] = [];
  const declaration = /=\s*([A-Za-z_]\w*)\s*:\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(text))) {
    const pointAt = text.lastIndexOf("@PointClass", match.index);
    const solidAt = text.lastIndexOf("@SolidClass", match.index);
    const baseAt = text.lastIndexOf("@BaseClass", match.index);
    const classAt = Math.max(pointAt, solidAt, baseAt);
    if (classAt < 0) continue;

    const nextClassAt = text.indexOf("@", match.index + match[0].length);
    const openAt = text.indexOf("[", match.index + match[0].length);
    if (openAt < 0 || (nextClassAt >= 0 && nextClassAt < openAt)) continue;
    const closeAt = matchingBracket(text, openAt);
    if (closeAt < 0) continue;

    const header = text.slice(classAt, match.index);
    const classType = header.match(/^@(PointClass|SolidClass|BaseClass)/)?.[1] ?? "Class";
    const bases =
      header
        .match(/base\s*\(([^)]*)\)/i)?.[1]
        .split(",")
        .map((base) => base.trim())
        .filter(Boolean) ?? [];
    entities.push({
      name: match[1],
      classType,
      description: match[2],
      bases,
      properties: parseTopLevelProperties(text.slice(openAt + 1, closeAt)),
    });
    declaration.lastIndex = closeAt + 1;
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
