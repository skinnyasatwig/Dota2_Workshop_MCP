import { z } from "zod";
import {
  MapContract,
  managedEntitiesForContract,
  parseMapContract,
} from "./map-contract.js";
import {
  MapEntityReconcileResult,
  reconcileMapEntities,
} from "./vmap.js";
import {
  TerrainReconcileResult,
  reconcileMapTerrain,
} from "./map-terrain.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const properties = z.record(scalar);
const point2 = z.tuple([z.number().finite(), z.number().finite()]);
const point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const terrainShapeInputSchema = z.discriminatedUnion("kind", [
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
  z.object({
    kind: z.literal("managedPath"),
    name: z.string().min(1),
    width: z.number().finite().positive(),
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
  mirrorAxis: z.enum(["x", "y", "xy"]).optional(),
}).strict();

export const mapSpecificationInputSchema = z.object({
  map: z.string().min(1).optional(),
  requiredEntities: z.array(mapEntityRequirementInputSchema).optional(),
  managedEntities: z.array(managedMapEntityInputSchema).optional(),
  managedAbsentEntities: z.array(managedAbsentEntityInputSchema).optional(),
  managedPaths: z.array(managedMapPathInputSchema).optional(),
  managedTerrain: z.array(terrainOperationInputSchema).optional(),
}).strict();

export function parseMapSpecification(value: unknown, path = "inline map specification"): MapContract {
  const parsed = mapSpecificationInputSchema.parse(value);
  return parseMapContract(
    {
      ...parsed,
      requiredEntities: parsed.requiredEntities ?? [],
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
