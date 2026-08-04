import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FgdEntity, FgdProperty, parseFgdEntities } from "./fgd.js";
import { ParsedMapEntity } from "./vmap.js";

export interface FgdDefinitionCatalog {
  entities: Map<string, FgdEntity>;
  propertiesFor(classname: string): Map<string, FgdProperty> | undefined;
}

export interface FgdValidationFinding {
  severity: "error" | "warn";
  code: "fgd-property-value-invalid" | "fgd-property-unknown" | "fgd-class-unknown";
  targetname: string;
  classname: string;
  property?: string;
  detail: string;
}

export interface FgdValidationReport {
  entityCount: number;
  knownClassCount: number;
  unknownClassNames: string[];
  checkedPropertyCount: number;
  unknownProperties: {
    classname: string;
    property: string;
    count: number;
    targetnames: string[];
  }[];
  findings: FgdValidationFinding[];
}

function mergeEntity(previous: FgdEntity | undefined, current: FgdEntity): FgdEntity {
  if (!previous) return current;
  const properties = new Map<string, FgdProperty>();
  for (const property of [...previous.properties, ...current.properties]) {
    properties.set(`${property.kind}:${property.name.toLowerCase()}`, property);
  }
  return {
    name: current.name,
    classType: current.classType === "OverrideClass" ? previous.classType : current.classType,
    description: current.description || previous.description,
    bases: [...new Set([...previous.bases, ...current.bases])],
    properties: [...properties.values()],
  };
}

export function buildFgdDefinitionCatalog(definitions: FgdEntity[]): FgdDefinitionCatalog {
  const entities = new Map<string, FgdEntity>();
  for (const definition of definitions) {
    entities.set(definition.name, mergeEntity(entities.get(definition.name), definition));
  }
  const propertyCache = new Map<string, Map<string, FgdProperty>>();
  const resolveProperties = (
    classname: string,
    resolving = new Set<string>(),
  ): Map<string, FgdProperty> | undefined => {
    const cached = propertyCache.get(classname);
    if (cached) return cached;
    const definition = entities.get(classname);
    if (!definition) return undefined;
    if (resolving.has(classname)) return new Map();
    resolving.add(classname);
    const properties = new Map<string, FgdProperty>();
    for (const base of definition.bases) {
      for (const [name, property] of resolveProperties(base, resolving) ?? []) {
        properties.set(name, property);
      }
    }
    for (const property of definition.properties) {
      if (property.kind === "keyvalue") properties.set(property.name.toLowerCase(), property);
    }
    resolving.delete(classname);
    propertyCache.set(classname, properties);
    return properties;
  };
  return {
    entities,
    propertiesFor: (classname) => resolveProperties(classname),
  };
}

function validPropertyValue(type: string, value: string): boolean {
  const normalized = type.trim().toLowerCase();
  if (normalized === "integer") return /^[-+]?\d+$/.test(value.trim());
  if (["float", "node_dest", "angle_negative_pitch"].includes(normalized)) {
    return value.trim() !== "" && Number.isFinite(Number(value));
  }
  if (normalized === "boolean") {
    return ["0", "1", "true", "false", "yes", "no"].includes(value.trim().toLowerCase());
  }
  if (["vector", "vector2d", "angle", "angles", "color255", "color1"].includes(normalized)) {
    const coordinates = value.trim().split(/\s+/).map(Number);
    return coordinates.length >= 2 && coordinates.every(Number.isFinite);
  }
  return true;
}

export function validateEntitiesAgainstFgd(
  entities: ParsedMapEntity[],
  catalog: FgdDefinitionCatalog,
  options: { strictUnknown?: boolean } = {},
): FgdValidationReport {
  // These are serialized map/tool fields accepted independently of a class's exposed keyvalue list.
  // `solid` and `use_animgraph` also come from Hammer's studioprop behavior, which is not represented
  // as normal textual FGD inheritance on every Dota building class.
  const intrinsicKeys = new Set(["classname", "targetname", "solid", "use_animgraph"]);
  const findings: FgdValidationFinding[] = [];
  const unknownClasses = new Set<string>();
  const unknownProperties = new Map<
    string,
    { classname: string; property: string; count: number; targetnames: Set<string> }
  >();
  let knownClassCount = 0;
  let checkedPropertyCount = 0;
  for (const entity of entities) {
    const properties = catalog.propertiesFor(entity.classname);
    const targetname = entity.targetname ?? "";
    if (!properties) {
      unknownClasses.add(entity.classname);
      if (options.strictUnknown) {
        findings.push({
          severity: "warn",
          code: "fgd-class-unknown",
          targetname,
          classname: entity.classname,
          detail: `Class "${entity.classname}" is not declared by the installed Valve FGD files.`,
        });
      }
      continue;
    }
    knownClassCount++;
    for (const [name, value] of Object.entries(entity.properties)) {
      if (intrinsicKeys.has(name.toLowerCase())) continue;
      const property = properties.get(name.toLowerCase());
      if (!property) {
        const key = `${entity.classname}\0${name.toLowerCase()}`;
        const aggregate = unknownProperties.get(key) ?? {
          classname: entity.classname,
          property: name,
          count: 0,
          targetnames: new Set<string>(),
        };
        aggregate.count++;
        if (targetname) aggregate.targetnames.add(targetname);
        unknownProperties.set(key, aggregate);
        if (options.strictUnknown) {
          findings.push({
            severity: "warn",
            code: "fgd-property-unknown",
            targetname,
            classname: entity.classname,
            property: name,
            detail: `${entity.classname} property "${name}" is not declared by its installed Valve FGD definition.`,
          });
        }
        continue;
      }
      checkedPropertyCount++;
      if (!validPropertyValue(property.type, value)) {
        findings.push({
          severity: "error",
          code: "fgd-property-value-invalid",
          targetname,
          classname: entity.classname,
          property: name,
          detail: `${entity.classname} property "${name}" expects ${property.type}; found "${value}".`,
        });
      }
    }
  }
  return {
    entityCount: entities.length,
    knownClassCount,
    unknownClassNames: [...unknownClasses].sort(),
    checkedPropertyCount,
    unknownProperties: [...unknownProperties.values()]
      .map((entry) => ({
        classname: entry.classname,
        property: entry.property,
        count: entry.count,
        targetnames: [...entry.targetnames].sort().slice(0, 10),
      }))
      .sort((a, b) => a.classname.localeCompare(b.classname) || a.property.localeCompare(b.property)),
    findings,
  };
}

let officialCatalogCache:
  | { dotaGameDir: string; promise: Promise<FgdDefinitionCatalog> }
  | undefined;

export function loadOfficialDotaFgdCatalog(dotaGameDir: string): Promise<FgdDefinitionCatalog> {
  if (officialCatalogCache?.dotaGameDir === dotaGameDir) return officialCatalogCache.promise;
  const promise = Promise.all([
    readFile(join(dotaGameDir, "..", "core", "base.fgd"), "utf8"),
    readFile(join(dotaGameDir, "dota.fgd"), "utf8"),
  ]).then(([base, dota]) => buildFgdDefinitionCatalog([
    ...parseFgdEntities(base),
    ...parseFgdEntities(dota),
  ]));
  officialCatalogCache = { dotaGameDir, promise };
  return promise;
}
