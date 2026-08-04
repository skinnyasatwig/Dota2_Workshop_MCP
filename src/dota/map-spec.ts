import { z } from "zod";
import {
  ManagedAbsentMapEntity,
  ManagedMapEntity,
  ManagedMapPath,
  MapContract,
  managedEntitiesForContract,
  parseMapContract,
} from "./map-contract.js";
import {
  ManagedTerrainOperation,
  ManagedTerrainShape,
} from "./map-terrain.js";
import {
  MapEntityReconcileResult,
  reconcileMapEntities,
} from "./vmap.js";
import {
  TerrainReconcileResult,
  reconcileMapTerrain,
} from "./map-terrain.js";
import {
  dotaComponentInputSchema,
  expandDotaComponents,
} from "./dota-components.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const properties = z.record(scalar);
const point2 = z.tuple([z.number().finite(), z.number().finite()]);
const point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const mirrorAxis = z.enum(["x", "y", "xy"]);
const componentName = z.string().regex(
  /^[A-Za-z_][A-Za-z0-9_.-]*$/,
  "must start with a letter or underscore and contain only letters, digits, _, ., or -",
);

export const primitiveTerrainShapeInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rect"),
    x0: z.number().finite(),
    y0: z.number().finite(),
    x1: z.number().finite(),
    y1: z.number().finite(),
  }).strict(),
  z.object({
    kind: z.literal("circle"),
    cx: z.number().finite(),
    cy: z.number().finite(),
    r: z.number().finite().positive(),
  }).strict(),
  z.object({
    kind: z.literal("ring"),
    cx: z.number().finite(),
    cy: z.number().finite(),
    rInner: z.number().finite().nonnegative(),
    rOuter: z.number().finite().positive(),
  }).strict(),
  z.object({
    kind: z.literal("path"),
    points: z.array(point2).min(2),
    width: z.number().finite().positive(),
  }).strict(),
  z.object({
    kind: z.literal("polygon"),
    points: z.array(point2).min(3),
  }).strict(),
]);

export const terrainShapeInputSchema = z.discriminatedUnion("kind", [
  ...primitiveTerrainShapeInputSchema.options,
  z.object({
    kind: z.literal("managedPath"),
    name: z.string().min(1),
    width: z.number().finite().positive(),
  }).strict(),
  z.object({
    kind: z.literal("region"),
    name: componentName,
  }).strict(),
]);

export const terrainOperationInputSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("fill"),
    level: z.number().int().optional(),
    water: z.boolean().optional(),
    tileset: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    op: z.literal("height"),
    shape: terrainShapeInputSchema,
    level: z.number().int(),
    dome: z.boolean().optional(),
  }).strict(),
  z.object({
    op: z.literal("water"),
    shape: terrainShapeInputSchema,
    on: z.boolean().optional(),
    invert: z.boolean().optional(),
  }).strict(),
  z.object({
    op: z.literal("tileset"),
    shape: terrainShapeInputSchema,
    tileset: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    op: z.literal("ramp"),
    shape: terrainShapeInputSchema,
  }).strict(),
]);

export const mapEntityRequirementInputSchema = z.object({
  targetname: z.string().min(1),
  classname: z.string().min(1).optional(),
  origin: z.string().min(1).optional(),
  angles: z.string().min(1).optional(),
  properties: properties.optional(),
  absentProperties: z.array(z.string().min(1)).optional(),
}).strict();

export const managedMapEntityInputSchema = z.object({
  targetname: z.string().min(1),
  classname: z.string().min(1),
  origin: z.string().min(1),
  angles: z.string().min(1).optional(),
  properties: properties.optional(),
  removeProperties: z.array(z.string().min(1)).optional(),
}).strict();

export const managedAbsentEntityInputSchema = z.object({
  classname: z.string().min(1),
  targetname: z.string().min(1).optional(),
  origin: z.string().min(1).optional(),
  angles: z.string().min(1).optional(),
}).strict();

export const managedMapPathInputSchema = z.object({
  name: z.string().min(1),
  points: z.array(point3).min(1),
  classname: z.string().min(1).optional(),
  startIndex: z.number().int().nonnegative().optional(),
  loop: z.boolean().optional(),
  angles: z.string().min(1).optional(),
  properties: properties.optional(),
  maxSegmentLength: z.number().finite().positive().optional(),
  mirrorOf: z.string().min(1).optional(),
  mirrorAxis: mirrorAxis.optional(),
}).strict();

export const regionDefinitionInputSchema = z.union([
  z.object({ shape: primitiveTerrainShapeInputSchema }).strict(),
  z.object({
    mirrorOf: componentName,
    mirrorAxis,
    around: point2.optional(),
    offset: point2.optional(),
  }).strict(),
]);

export const componentDefinitionInputSchema = z.object({
  managedEntities: z.array(managedMapEntityInputSchema).optional(),
  managedAbsentEntities: z.array(managedAbsentEntityInputSchema).optional(),
  managedPaths: z.array(managedMapPathInputSchema).optional(),
  managedTerrain: z.array(terrainOperationInputSchema).optional(),
}).strict();

export const componentPlacementInputSchema = z.object({
  component: componentName,
  name: componentName,
  worldOffset: point3.optional(),
  tileOffset: point2.optional(),
  mirrorAxis: mirrorAxis.optional(),
}).strict();

export const mapSpecificationInputSchema = z.object({
  map: z.string().min(1).optional(),
  requiredEntities: z.array(mapEntityRequirementInputSchema).optional(),
  managedEntities: z.array(managedMapEntityInputSchema).optional(),
  managedAbsentEntities: z.array(managedAbsentEntityInputSchema).optional(),
  managedPaths: z.array(managedMapPathInputSchema).optional(),
  managedTerrain: z.array(terrainOperationInputSchema).optional(),
  regions: z.record(regionDefinitionInputSchema).optional(),
  components: z.record(componentDefinitionInputSchema).optional(),
  placements: z.array(componentPlacementInputSchema).optional(),
  dotaComponents: z.array(dotaComponentInputSchema).optional(),
}).strict();

type MirrorAxis = z.infer<typeof mirrorAxis>;
type PrimitiveTerrainShape = z.infer<typeof primitiveTerrainShapeInputSchema>;
type TerrainShapeInput = z.infer<typeof terrainShapeInputSchema>;
type TerrainOperationInput = z.infer<typeof terrainOperationInputSchema>;
type RegionDefinitionInput = z.infer<typeof regionDefinitionInputSchema>;
type ComponentPlacementInput = z.infer<typeof componentPlacementInputSchema>;

function transformPoint2(
  point: [number, number],
  axis: MirrorAxis | undefined,
  offset: [number, number] = [0, 0],
  around: [number, number] = [0, 0],
): [number, number] {
  let [x, y] = point;
  if (axis?.includes("x")) x = 2 * around[0] - x;
  if (axis?.includes("y")) y = 2 * around[1] - y;
  return [x + offset[0], y + offset[1]];
}

function transformPrimitiveShape(
  shape: PrimitiveTerrainShape,
  axis?: MirrorAxis,
  offset: [number, number] = [0, 0],
  around: [number, number] = [0, 0],
): PrimitiveTerrainShape {
  switch (shape.kind) {
    case "rect": {
      const corners = [
        transformPoint2([shape.x0, shape.y0], axis, offset, around),
        transformPoint2([shape.x0, shape.y1], axis, offset, around),
        transformPoint2([shape.x1, shape.y0], axis, offset, around),
        transformPoint2([shape.x1, shape.y1], axis, offset, around),
      ];
      return {
        kind: "rect",
        x0: Math.min(...corners.map(([x]) => x)),
        y0: Math.min(...corners.map(([, y]) => y)),
        x1: Math.max(...corners.map(([x]) => x)),
        y1: Math.max(...corners.map(([, y]) => y)),
      };
    }
    case "circle": {
      const [cx, cy] = transformPoint2([shape.cx, shape.cy], axis, offset, around);
      return { ...shape, cx, cy };
    }
    case "ring": {
      const [cx, cy] = transformPoint2([shape.cx, shape.cy], axis, offset, around);
      return { ...shape, cx, cy };
    }
    case "path":
      return {
        ...shape,
        points: shape.points.map((point) => transformPoint2(point, axis, offset, around)),
      };
    case "polygon":
      return {
        ...shape,
        points: shape.points.map((point) => transformPoint2(point, axis, offset, around)),
      };
  }
}

function resolveRegions(
  definitions: Record<string, RegionDefinitionInput>,
  path: string,
): Map<string, PrimitiveTerrainShape> {
  const resolved = new Map<string, PrimitiveTerrainShape>();
  const resolving = new Set<string>();
  const resolve = (name: string): PrimitiveTerrainShape => {
    const cached = resolved.get(name);
    if (cached) return cached;
    const definition = definitions[name];
    if (!definition) throw new Error(`Region "${name}" is not defined: ${path}`);
    if (resolving.has(name)) {
      throw new Error(`Region definitions contain a mirror cycle at "${name}": ${path}`);
    }
    resolving.add(name);
    const shape = "shape" in definition
      ? definition.shape
      : transformPrimitiveShape(
          resolve(definition.mirrorOf),
          definition.mirrorAxis,
          definition.offset,
          definition.around,
        );
    resolving.delete(name);
    resolved.set(name, shape);
    return shape;
  };
  for (const name of Object.keys(definitions)) {
    if (!componentName.safeParse(name).success) {
      throw new Error(`Invalid region name "${name}": ${path}`);
    }
    resolve(name);
  }
  return resolved;
}

function resolveTerrainShape(
  shape: TerrainShapeInput,
  regions: Map<string, PrimitiveTerrainShape>,
  path: string,
): ManagedTerrainShape {
  if (shape.kind !== "region") return shape;
  const region = regions.get(shape.name);
  if (!region) throw new Error(`Terrain references missing region "${shape.name}": ${path}`);
  return region;
}

function expandTerrainOperations(
  operations: TerrainOperationInput[] | undefined,
  regions: Map<string, PrimitiveTerrainShape>,
  path: string,
): ManagedTerrainOperation[] {
  return (operations ?? []).map((operation) => {
    if (operation.op === "fill") return operation;
    return { ...operation, shape: resolveTerrainShape(operation.shape, regions, path) };
  });
}

function formatNumber(value: number): string {
  const rounded = Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
  return String(rounded);
}

function parseVector(value: string, field: string, path: string): [number, number, number] {
  const values = value.trim().split(/\s+/).map(Number);
  if (values.length !== 3 || values.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error(`${field} must contain three finite numbers: ${path}`);
  }
  return values as [number, number, number];
}

function transformVectorString(
  value: string,
  axis: MirrorAxis | undefined,
  offset: [number, number, number],
  field: string,
  path: string,
): string {
  const [x, y, z] = parseVector(value, field, path);
  return [
    (axis?.includes("x") ? -x : x) + offset[0],
    (axis?.includes("y") ? -y : y) + offset[1],
    z + offset[2],
  ].map(formatNumber).join(" ");
}

function transformAngles(
  value: string | undefined,
  axis: MirrorAxis | undefined,
  field: string,
  path: string,
): string | undefined {
  if (!value || !axis) return value;
  const [pitch, initialYaw, roll] = parseVector(value, field, path);
  let yaw = initialYaw;
  if (axis.includes("x")) yaw = 180 - yaw;
  if (axis.includes("y")) yaw = -yaw;
  yaw = ((yaw % 360) + 360) % 360;
  return [pitch, yaw, roll].map(formatNumber).join(" ");
}

function localName(instance: string, name: string): string {
  return `${instance}_${name}`;
}

function localProperties(
  properties: Record<string, string> | undefined,
  instance: string,
): Record<string, string> | undefined {
  if (!properties) return undefined;
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      value.replace(/@local:([A-Za-z_][A-Za-z0-9_.-]*)/g, (_match, name: string) =>
        localName(instance, name)),
    ]),
  );
}

function transformComponentTerrain(
  operation: ManagedTerrainOperation,
  placement: ComponentPlacementInput,
  path: string,
): ManagedTerrainOperation {
  if (operation.op === "fill") {
    throw new Error(
      `Component "${placement.component}" uses fill, which would overwrite the whole map: ${path}`,
    );
  }
  if (operation.shape.kind === "managedPath") {
    return {
      ...operation,
      shape: { ...operation.shape, name: localName(placement.name, operation.shape.name) },
    };
  }
  return {
    ...operation,
    shape: transformPrimitiveShape(
      operation.shape,
      placement.mirrorAxis,
      placement.tileOffset,
    ),
  };
}

function expandComponent(
  component: MapContract,
  placement: ComponentPlacementInput,
  path: string,
): Pick<MapContract, "managedEntities" | "managedAbsentEntities" | "managedPaths" | "managedTerrain"> {
  const worldOffset = placement.worldOffset ?? [0, 0, 0];
  const transformOrigin = (origin: string, field: string) =>
    transformVectorString(origin, placement.mirrorAxis, worldOffset, field, path);
  const transformEntity = (entity: ManagedMapEntity): ManagedMapEntity => ({
    ...entity,
    targetname: localName(placement.name, entity.targetname),
    origin: transformOrigin(entity.origin, `${fieldPrefix(placement)}.${entity.targetname}.origin`),
    angles: transformAngles(
      entity.angles,
      placement.mirrorAxis,
      `${fieldPrefix(placement)}.${entity.targetname}.angles`,
      path,
    ),
    properties: localProperties(entity.properties, placement.name),
  });
  const transformAbsent = (entity: ManagedAbsentMapEntity): ManagedAbsentMapEntity => ({
    ...entity,
    targetname: entity.targetname ? localName(placement.name, entity.targetname) : undefined,
    origin: entity.origin
      ? transformOrigin(entity.origin, `${fieldPrefix(placement)}.managedAbsentEntities.origin`)
      : undefined,
    angles: transformAngles(
      entity.angles,
      placement.mirrorAxis,
      `${fieldPrefix(placement)}.managedAbsentEntities.angles`,
      path,
    ),
  });
  const transformPath = (managedPath: ManagedMapPath): ManagedMapPath => ({
    ...managedPath,
    name: localName(placement.name, managedPath.name),
    points: managedPath.points.map(([x, y, z]) => [
      (placement.mirrorAxis?.includes("x") ? -x : x) + worldOffset[0],
      (placement.mirrorAxis?.includes("y") ? -y : y) + worldOffset[1],
      z + worldOffset[2],
    ]),
    angles: transformAngles(
      managedPath.angles,
      placement.mirrorAxis,
      `${fieldPrefix(placement)}.${managedPath.name}.angles`,
      path,
    ),
    properties: localProperties(managedPath.properties, placement.name),
    // Local mirror relationships were checked before placement. Translation changes the mirror plane,
    // so retaining the world-origin assertion here would be incorrect.
    mirrorOf: undefined,
    mirrorAxis: undefined,
  });
  return {
    managedEntities: (component.managedEntities ?? []).map(transformEntity),
    managedAbsentEntities: (component.managedAbsentEntities ?? []).map(transformAbsent),
    managedPaths: (component.managedPaths ?? []).map(transformPath),
    managedTerrain: (component.managedTerrain ?? []).map((operation) =>
      transformComponentTerrain(operation, placement, path)),
  };
}

function fieldPrefix(placement: ComponentPlacementInput): string {
  return `placement "${placement.name}"`;
}

export function parseMapSpecification(value: unknown, path = "inline map specification"): MapContract {
  const parsed = mapSpecificationInputSchema.parse(value);
  const regions = resolveRegions(parsed.regions ?? {}, path);
  const dotaComponents = expandDotaComponents(parsed.dotaComponents ?? []);
  const componentContracts = new Map<string, MapContract>();
  for (const [name, definition] of Object.entries(parsed.components ?? {})) {
    if (!componentName.safeParse(name).success) {
      throw new Error(`Invalid component name "${name}": ${path}`);
    }
    const managedTerrain = expandTerrainOperations(
      definition.managedTerrain,
      regions,
      `${path}, component "${name}"`,
    );
    if (managedTerrain.some((operation) => operation.op === "fill")) {
      throw new Error(`Component "${name}" cannot contain a fill terrain operation: ${path}`);
    }
    componentContracts.set(
      name,
      parseMapContract(
        {
          requiredEntities: [],
          managedEntities: definition.managedEntities,
          managedAbsentEntities: definition.managedAbsentEntities,
          managedPaths: definition.managedPaths,
          managedTerrain,
        },
        `${path}, component "${name}"`,
      ),
    );
  }

  const placementNames = new Set<string>();
  const expandedComponents = (parsed.placements ?? []).map((placement) => {
    if (placementNames.has(placement.name)) {
      throw new Error(`Component placement name "${placement.name}" is duplicated: ${path}`);
    }
    placementNames.add(placement.name);
    const component = componentContracts.get(placement.component);
    if (!component) {
      throw new Error(
        `Placement "${placement.name}" references missing component "${placement.component}": ${path}`,
      );
    }
    return expandComponent(component, placement, path);
  });

  return parseMapContract(
    {
      map: parsed.map,
      requiredEntities: parsed.requiredEntities ?? [],
      managedEntities: [
        ...(parsed.managedEntities ?? []),
        ...dotaComponents.managedEntities,
        ...expandedComponents.flatMap((component) => component.managedEntities ?? []),
      ],
      managedAbsentEntities: [
        ...(parsed.managedAbsentEntities ?? []),
        ...expandedComponents.flatMap((component) => component.managedAbsentEntities ?? []),
      ],
      managedPaths: [
        ...(parsed.managedPaths ?? []),
        ...expandedComponents.flatMap((component) => component.managedPaths ?? []),
      ],
      managedTerrain: [
        ...expandTerrainOperations(parsed.managedTerrain, regions, path),
        ...dotaComponents.managedTerrain,
        ...expandedComponents.flatMap((component) => component.managedTerrain ?? []),
      ],
    },
    path,
  );
}

export interface MapSpecificationReconcileResult {
  text: string;
  changed: boolean;
  entities: MapEntityReconcileResult;
  terrain: TerrainReconcileResult;
}

/** Apply the desired-state portions of one validated map specification. */
export function reconcileMapSpecification(
  text: string,
  specification: MapContract,
): MapSpecificationReconcileResult {
  const entities = reconcileMapEntities(text, managedEntitiesForContract(specification), {
    prunePrefixes: (specification.managedPaths ?? []).map((path) => path.name),
    absentEntities: specification.managedAbsentEntities ?? [],
  });
  const terrain = reconcileMapTerrain(
    entities.text,
    specification.managedTerrain ?? [],
    specification.managedPaths ?? [],
  );
  return {
    text: terrain.text,
    changed:
      entities.added.length + entities.updated.length + entities.removed.length > 0 ||
      terrain.changed,
    entities,
    terrain,
  };
}
