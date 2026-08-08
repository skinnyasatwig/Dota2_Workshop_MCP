import { z } from "zod";
import { ManagedMapEntity } from "./map-contract.js";
import {
  ManagedMapSolid,
  managedMapSolidFaceMaterialsInputSchema,
  managedMapSolidFaceTextureScalesInputSchema,
  ManagedMapSolidFaceTextureScales,
  managedMapSolidFaceTextureShiftsInputSchema,
  ManagedMapSolidFaceTextureShifts,
  managedMapSolidFaceTextureRotationsInputSchema,
  ManagedMapSolidFaceTextureRotations,
  managedMapSolidFaceTextureAlignmentsInputSchema,
  ManagedMapSolidFaceTextureAlignments,
  pointOnSegment,
  segmentsTouchOrIntersect,
  signedPolygonArea,
  simplePolygonError,
} from "./map-solid.js";
import { ManagedMapNavSurface } from "./map-nav-surface.js";
import { ManagedTerrainOperation } from "./map-terrain.js";
import { ManagedMapVolume, regularPolygonFootprint } from "./map-volume.js";
import { partitionPolygonWithHoles } from "./polygon-holes.js";

const point2 = z.tuple([z.number().finite(), z.number().finite()]);
const point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const volumeSize = z.tuple([
  z.number().finite().positive().max(32768),
  z.number().finite().positive().max(32768),
  z.number().finite().positive().max(32768),
]);
const teamSchema = z.enum(["radiant", "dire"]);
const nameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/);
const yawSchema = z.number().finite().optional();
const laneSchema = z.enum(["top", "mid", "bot"]);
const tierSchema = z.number().int().min(1).max(4);
const visibleMaterialSchema = z.string()
  .regex(/^materials\/[A-Za-z0-9_./-]+\.vmat$/i)
  .refine((value) => !value.split("/").includes(".."), "must not contain parent-directory segments")
  .refine((value) => !value.toLowerCase().startsWith("materials/tools/"),
    "must be a visible world material");
const modelResourceSchema = z.string()
  .regex(/^models\/[A-Za-z0-9_./-]+\.vmdl$/i, "must be a models/*.vmdl resource")
  .refine((value) => !value.split("/").includes(".."), "must not contain parent-directory segments");

const ancientComponentSchema = z.object({
  kind: z.literal("ancient"),
  name: nameSchema,
  team: teamSchema,
  origin: point3,
  yaw: yawSchema,
  invulnerabilityLinks: z.number().int().nonnegative().optional(),
  vulnerableOnCreepSpawn: z.boolean().optional(),
}).strict();

const towerComponentSchema = z.object({
  kind: z.literal("tower"),
  name: nameSchema,
  team: teamSchema,
  origin: point3,
  yaw: yawSchema,
  tier: tierSchema,
  lane: laneSchema.optional(),
  invulnerabilityLinks: z.number().int().nonnegative().optional(),
  vulnerableOnCreepSpawn: z.boolean().optional(),
}).strict().superRefine((tower, context) => {
  if (tower.tier < 4 && !tower.lane) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lane"],
      message: "lane is required for tier 1-3 towers",
    });
  }
});

const fountainComponentSchema = z.object({
  kind: z.literal("fountain"),
  name: nameSchema,
  team: teamSchema,
  origin: point3,
  yaw: yawSchema,
}).strict();

const shopComponentSchema = z.object({
  kind: z.literal("shop"),
  name: nameSchema,
  origin: point3,
  yaw: yawSchema,
  shopType: z.enum(["home", "side", "secret", "custom"]),
  team: teamSchema.optional(),
  model: z.string().min(1).optional(),
}).strict();

const campComponentSchema = z.object({
  kind: z.literal("camp"),
  name: nameSchema,
  origin: point3,
  yaw: yawSchema,
  size: z.enum(["small", "medium", "hard", "ancient"]),
  volumeName: nameSchema,
  forcedSubtype: z.number().int().min(0).max(7).optional(),
  pullType: z.number().int().min(0).max(5).optional(),
  aggroType: z.number().int().min(0).max(1).optional(),
  volume: z.object({
    center: point3.optional(),
    size: volumeSize,
    yaw: z.number().finite().optional(),
  }).strict().optional(),
}).strict();

const playerStartComponentSchema = z.object({
  kind: z.literal("playerStart"),
  name: nameSchema,
  team: teamSchema,
  origin: point3,
  yaw: yawSchema,
  disabled: z.boolean().optional(),
}).strict();

const gateComponentSchema = z.object({
  kind: z.literal("gate"),
  name: nameSchema,
  team: teamSchema,
  origin: point3,
  yaw: yawSchema,
  gateType: z.enum(["twin"]).optional(),
}).strict();

const baseBlockerComponentSchema = z.object({
  kind: z.literal("baseBlocker"),
  name: nameSchema,
  team: teamSchema,
  origin: point3,
  yaw: yawSchema,
}).strict();

const fowBlockerComponentSchema = z.object({
  kind: z.literal("fowBlocker"),
  name: nameSchema,
  points: z.array(point3).min(2).max(512),
  closed: z.boolean().optional(),
}).strict();

const wallComponentSchema = z.object({
  kind: z.literal("wall"),
  name: nameSchema,
  points: z.array(point3).min(2).max(256),
  thickness: z.number().finite().positive().max(4096),
  height: z.number().finite().positive().max(32768),
  overlap: z.number().finite().nonnegative().max(4096).optional(),
  closed: z.boolean().optional(),
}).strict().superRefine((wall, context) => {
  for (let index = 0; index < wall.points.length - 1; index++) {
    const current = wall.points[index];
    const next = wall.points[index + 1];
    if (current[0] === next[0] && current[1] === next[1]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["points", index + 1],
        message: "must not repeat the preceding XY point",
      });
    }
    if (Math.abs(current[2] - next[2]) > 1e-6) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["points", index + 1, 2],
        message: "must use the same base Z as the preceding point; sloped wall segments are not yet supported",
      });
    }
  }
  if (wall.closed && wall.points.length > 2) {
    const first = wall.points[0];
    const last = wall.points[wall.points.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["points", wall.points.length - 1],
        message: "must not repeat the first point when closed=true",
      });
    }
    if (Math.abs(first[2] - last[2]) > 1e-6) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["points", wall.points.length - 1, 2],
        message: "must use the same base Z as the first point when closed=true",
      });
    }
  }
});

const staticPropPlacementSchema = z.object({
  name: nameSchema,
  /** Local offset from the set origin. */
  offset: point3,
  yaw: z.number().finite().optional(),
}).strict();

const staticPropSetComponentSchema = z.object({
  kind: z.literal("staticPropSet"),
  name: nameSchema,
  /** World-space origin for the reusable set. */
  origin: point3,
  yaw: yawSchema,
  /** One checked model resource shared by every placement in this set. */
  model: modelResourceSchema,
  /** Required so scenery never acquires pathing collision by accident. */
  collision: z.enum(["none", "vphysics"]),
  castShadows: z.boolean().optional(),
  tint: z.tuple([
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
    z.number().int().min(0).max(255),
  ]).optional(),
  placements: z.array(staticPropPlacementSchema).min(1).max(256),
}).strict().superRefine((set, context) => {
  const seen = new Set<string>();
  set.placements.forEach((placement, index) => {
    const key = placement.name.toLowerCase();
    if (seen.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placements", index, "name"],
        message: "must be unique within the static prop set (case-insensitive)",
      });
    }
    seen.add(key);
  });
});

const archComponentSchema = z.object({
  kind: z.literal("arch"),
  name: nameSchema,
  /** World-space center of the arch at its base elevation. */
  origin: point3,
  yaw: yawSchema,
  width: z.number().finite().min(1).max(32768),
  depth: z.number().finite().min(1).max(32768),
  height: z.number().finite().min(1).max(32768),
  openingWidth: z.number().finite().min(1).max(32768),
  openingHeight: z.number().finite().min(1).max(32768),
  material: visibleMaterialSchema,
  faceMaterials: managedMapSolidFaceMaterialsInputSchema.optional(),
  faceTextureScales: managedMapSolidFaceTextureScalesInputSchema.optional(),
  faceTextureShifts: managedMapSolidFaceTextureShiftsInputSchema.optional(),
  faceTextureRotations: managedMapSolidFaceTextureRotationsInputSchema.optional(),
  faceTextureAlignments: managedMapSolidFaceTextureAlignmentsInputSchema.optional(),
}).strict().superRefine((arch, context) => {
  if (arch.openingWidth >= arch.width) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openingWidth"],
      message: "openingWidth must be smaller than the outer width",
    });
  }
  if (arch.openingHeight >= arch.height) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openingHeight"],
      message: "openingHeight must be smaller than the outer height",
    });
  }
  if (arch.openingWidth < arch.width && arch.width - arch.openingWidth < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openingWidth"],
      message: "openingWidth must leave at least one world unit for each post",
    });
  }
  if (arch.openingHeight < arch.height && arch.height - arch.openingHeight < 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openingHeight"],
      message: "openingHeight must leave at least one world unit for the lintel",
    });
  }
});

const profileArchComponentSchema = z.object({
  kind: z.literal("profileArch"),
  name: nameSchema,
  /** World-space center of the outer arch rectangle at its base elevation. */
  origin: point3,
  yaw: yawSchema,
  width: z.number().finite().min(3).max(32768),
  depth: z.number().finite().min(1).max(32768),
  height: z.number().finite().min(2).max(32768),
  /** Local [x,z] points along the opening's underside, ordered left to right. */
  profile: z.array(point2).min(2).max(64),
  material: visibleMaterialSchema,
  faceMaterials: managedMapSolidFaceMaterialsInputSchema.optional(),
  faceTextureScales: managedMapSolidFaceTextureScalesInputSchema.optional(),
  faceTextureShifts: managedMapSolidFaceTextureShiftsInputSchema.optional(),
  faceTextureRotations: managedMapSolidFaceTextureRotationsInputSchema.optional(),
  faceTextureAlignments: managedMapSolidFaceTextureAlignmentsInputSchema.optional(),
}).strict().superRefine((arch, context) => {
  const left = -arch.width / 2;
  const right = arch.width / 2;
  arch.profile.forEach(([x, zValue], index) => {
    if (x < left + 1 || x > right - 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", index, 0],
        message: "must leave at least one world unit for both outer posts",
      });
    }
    if (zValue < 1 || zValue > arch.height - 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", index, 1],
        message: "must stay at least one world unit above the base and below the outer height",
      });
    }
    if (index > 0 && x - arch.profile[index - 1][0] < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", index, 0],
        message: "must be at least one world unit to the right of the preceding profile point",
      });
    }
  });
});

const bridgeComponentSchema = z.object({
  kind: z.literal("bridge"),
  name: nameSchema,
  /** World-space center of the physical deck prism. Local X runs along the bridge. */
  center: point3,
  yaw: yawSchema,
  length: z.number().finite().min(2).max(32768),
  width: z.number().finite().min(2).max(32768),
  thickness: z.number().finite().min(1).max(4096),
  material: visibleMaterialSchema,
  faceMaterials: managedMapSolidFaceMaterialsInputSchema.optional(),
  faceTextureScales: managedMapSolidFaceTextureScalesInputSchema.optional(),
  faceTextureShifts: managedMapSolidFaceTextureShiftsInputSchema.optional(),
  faceTextureRotations: managedMapSolidFaceTextureRotationsInputSchema.optional(),
  faceTextureAlignments: managedMapSolidFaceTextureAlignmentsInputSchema.optional(),
}).strict();

const bridgeApproachComponentSchema = z.object({
  kind: z.literal("bridgeApproach"),
  name: nameSchema,
  /** World-space centers of the walkable top surface at each end. */
  start: point3,
  end: point3,
  width: z.number().finite().min(2).max(32768),
  thickness: z.number().finite().min(1).max(4096),
  material: visibleMaterialSchema,
  faceMaterials: managedMapSolidFaceMaterialsInputSchema.optional(),
  faceTextureScales: managedMapSolidFaceTextureScalesInputSchema.optional(),
  faceTextureShifts: managedMapSolidFaceTextureShiftsInputSchema.optional(),
  faceTextureRotations: managedMapSolidFaceTextureRotationsInputSchema.optional(),
  faceTextureAlignments: managedMapSolidFaceTextureAlignmentsInputSchema.optional(),
}).strict().superRefine((approach, context) => {
  if (Math.hypot(approach.end[0] - approach.start[0], approach.end[1] - approach.start[1]) < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end"],
      message: "bridge approach endpoints must be at least two horizontal world units apart",
    });
  }
});

const ringPlatformComponentSchema = z.object({
  kind: z.literal("ringPlatform"),
  name: nameSchema,
  /** World-space center of the complete platform prism. */
  center: point3,
  yaw: yawSchema,
  /** Vertex radii of the regular outer edge and central opening. */
  outerRadius: z.number().finite().min(4).max(16384),
  innerRadius: z.number().finite().min(2).max(16382),
  height: z.number().finite().min(1).max(4096),
  sides: z.number().int().min(3).max(32).optional(),
  material: visibleMaterialSchema,
  faceMaterials: managedMapSolidFaceMaterialsInputSchema.optional(),
  faceTextureScales: managedMapSolidFaceTextureScalesInputSchema.optional(),
  faceTextureShifts: managedMapSolidFaceTextureShiftsInputSchema.optional(),
  faceTextureRotations: managedMapSolidFaceTextureRotationsInputSchema.optional(),
  faceTextureAlignments: managedMapSolidFaceTextureAlignmentsInputSchema.optional(),
}).strict().superRefine((platform, context) => {
  if (platform.outerRadius - platform.innerRadius < 2) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["innerRadius"],
      message: "innerRadius must leave at least two world units of platform inside outerRadius",
    });
  }
});

interface OutlineValidationIssue {
  path: (string | number)[];
  message: string;
}

function pointStrictlyInsidePolygon(
  point: [number, number],
  polygon: readonly [number, number][],
): boolean {
  if (polygon.some((start, index) => pointOnSegment(point, start, polygon[(index + 1) % polygon.length]))) {
    return false;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    if (
      (y > point[1]) !== (previousY > point[1]) &&
      point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function counterClockwiseOutline(points: [number, number][]): [number, number][] {
  const ordered = signedPolygonArea(points) < 0
    ? [points[0], ...points.slice(1).reverse()]
    : [...points];
  return ordered.map(([x, y]) => [normalizedNumber(x), normalizedNumber(y)]);
}

function outlinePerimeter(points: readonly [number, number][]): number {
  return points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + Math.hypot(next[0] - point[0], next[1] - point[1]);
  }, 0);
}

function outlineVertexFractions(points: readonly [number, number][]): number[] {
  const perimeter = outlinePerimeter(points);
  const fractions = [0];
  let traversed = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const next = points[index + 1];
    traversed += Math.hypot(next[0] - points[index][0], next[1] - points[index][1]);
    fractions.push(traversed / perimeter);
  }
  return fractions;
}

function sampleOutlineAtFraction(
  points: readonly [number, number][],
  fraction: number,
): [number, number] {
  const perimeter = outlinePerimeter(points);
  const target = fraction * perimeter;
  let traversed = 0;
  for (let index = 0; index < points.length; index++) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (target <= traversed + length + 1e-9) {
      const ratio = Math.max(0, Math.min(1, (target - traversed) / length));
      return [
        normalizedNumber(start[0] + (end[0] - start[0]) * ratio),
        normalizedNumber(start[1] + (end[1] - start[1]) * ratio),
      ];
    }
    traversed += length;
  }
  return [...points[0]];
}

function pairedPlatformOutlines(
  outerInput: [number, number][],
  holeInput: [number, number][],
): { outer: [number, number][]; hole: [number, number][] } {
  const outer = counterClockwiseOutline(outerInput);
  const hole = counterClockwiseOutline(holeInput);
  if (outer.length === hole.length) return { outer, hole };
  const fractions = [...outlineVertexFractions(outer), ...outlineVertexFractions(hole)]
    .sort((left, right) => left - right)
    .filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]) > 1e-9);
  return {
    outer: fractions.map((fraction) => sampleOutlineAtFraction(outer, fraction)),
    hole: fractions.map((fraction) => sampleOutlineAtFraction(hole, fraction)),
  };
}

function validatePairedPlatformOutlines(
  outer: [number, number][],
  hole: [number, number][],
): OutlineValidationIssue[] {
  const issues: OutlineValidationIssue[] = [];
  const outerError = simplePolygonError(outer);
  const holeError = simplePolygonError(hole);
  if (outerError) issues.push({ path: ["outer"], message: `outer outline ${outerError}` });
  if (holeError) issues.push({ path: ["hole"], message: `hole outline ${holeError}` });
  if (outerError || holeError) return issues;
  const outerArea = signedPolygonArea(outer);
  const holeArea = signedPolygonArea(hole);
  if (Math.sign(outerArea) !== Math.sign(holeArea)) {
    issues.push({
      path: ["hole"],
      message: "must use the same clockwise or counter-clockwise point order as outer",
    });
    return issues;
  }
  for (let index = 0; index < hole.length; index++) {
    if (!pointStrictlyInsidePolygon(hole[index], outer)) {
      issues.push({
        path: ["hole", index],
        message: "must stay strictly inside the outer outline",
      });
    }
  }
  for (let outerIndex = 0; outerIndex < outer.length; outerIndex++) {
    const outerNext = (outerIndex + 1) % outer.length;
    for (let holeIndex = 0; holeIndex < hole.length; holeIndex++) {
      const holeNext = (holeIndex + 1) % hole.length;
      if (segmentsTouchOrIntersect(
        outer[outerIndex], outer[outerNext], hole[holeIndex], hole[holeNext],
      )) {
        issues.push({ path: ["hole"], message: "must not touch or cross the outer outline" });
        return issues;
      }
    }
  }
  const paired = pairedPlatformOutlines(outer, hole);
  const spokes = paired.outer.map((point, index) => [point, paired.hole[index]] as const);
  for (let index = 0; index < spokes.length; index++) {
    const [from, to] = spokes[index];
    const midpoint: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    if (!pointStrictlyInsidePolygon(midpoint, paired.outer) || pointStrictlyInsidePolygon(midpoint, paired.hole)) {
      issues.push({
        path: ["hole", index],
        message: "must form a platform segment that stays between the outer and hole outlines",
      });
      return issues;
    }
    for (let edge = 0; edge < paired.outer.length; edge++) {
      const next = (edge + 1) % paired.outer.length;
      if (edge !== index && next !== index && segmentsTouchOrIntersect(
        from, to, paired.outer[edge], paired.outer[next],
      )) {
        issues.push({ path: ["hole", index], message: "corresponding spoke crosses the outer outline" });
        return issues;
      }
      if (edge !== index && next !== index && segmentsTouchOrIntersect(
        from, to, paired.hole[edge], paired.hole[next],
      )) {
        issues.push({ path: ["hole", index], message: "corresponding spoke crosses the hole outline" });
        return issues;
      }
    }
    for (let other = index + 1; other < spokes.length; other++) {
      if (segmentsTouchOrIntersect(from, to, spokes[other][0], spokes[other][1])) {
        issues.push({ path: ["hole", other], message: "corresponding platform spokes must not cross" });
        return issues;
      }
    }
  }
  let segmentArea = 0;
  for (let index = 0; index < paired.outer.length; index++) {
    const next = (index + 1) % paired.outer.length;
    const segment: [number, number][] = [
      paired.outer[index], paired.outer[next], paired.hole[next], paired.hole[index],
    ];
    const segmentError = simplePolygonError(segment);
    const area = signedPolygonArea(segment);
    if (segmentError || area <= 1) {
      issues.push({
        path: ["hole", index],
        message: `corresponding points do not form a safe platform segment${segmentError ? `: ${segmentError}` : ""}`,
      });
      return issues;
    }
    segmentArea += area;
  }
  const expectedArea = Math.abs(outerArea) - Math.abs(holeArea);
  const areaTolerance = Math.max(1e-5, expectedArea * 1e-8);
  if (expectedArea <= 1 || Math.abs(segmentArea - expectedArea) > areaTolerance) {
    issues.push({
      path: ["hole"],
      message: "corresponding outlines must partition the platform without gaps or overlaps",
    });
  }
  return issues;
}

const holedPlatformComponentSchema = z.object({
  kind: z.literal("holedPlatform"),
  name: nameSchema,
  /** World-space center of the complete platform prism. Outlines are local XY coordinates. */
  center: point3,
  yaw: yawSchema,
  /** Simple outlines. Equal counts use explicit pairs; unequal counts are safely perimeter-subdivided. */
  outer: z.array(point2).min(3).max(64),
  hole: z.array(point2).min(3).max(64),
  height: z.number().finite().min(1).max(4096),
  material: visibleMaterialSchema,
  faceMaterials: managedMapSolidFaceMaterialsInputSchema.optional(),
  faceTextureScales: managedMapSolidFaceTextureScalesInputSchema.optional(),
  faceTextureShifts: managedMapSolidFaceTextureShiftsInputSchema.optional(),
  faceTextureRotations: managedMapSolidFaceTextureRotationsInputSchema.optional(),
  faceTextureAlignments: managedMapSolidFaceTextureAlignmentsInputSchema.optional(),
}).strict().superRefine((platform, context) => {
  for (const issue of validatePairedPlatformOutlines(platform.outer, platform.hole)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
  }
});

const multiHoledPlatformComponentSchema = z.object({
  kind: z.literal("multiHoledPlatform"),
  name: nameSchema,
  /** World-space center of the complete platform prism. Outlines are local XY coordinates. */
  center: point3,
  yaw: yawSchema,
  outer: z.array(point2).min(3).max(64),
  holes: z.array(z.array(point2).min(3).max(64)).min(2).max(8),
  height: z.number().finite().min(1).max(4096),
  material: visibleMaterialSchema,
  faceMaterials: managedMapSolidFaceMaterialsInputSchema.optional(),
  faceTextureScales: managedMapSolidFaceTextureScalesInputSchema.optional(),
  faceTextureShifts: managedMapSolidFaceTextureShiftsInputSchema.optional(),
  faceTextureRotations: managedMapSolidFaceTextureRotationsInputSchema.optional(),
  faceTextureAlignments: managedMapSolidFaceTextureAlignmentsInputSchema.optional(),
}).strict().superRefine((platform, context) => {
  try {
    partitionPolygonWithHoles(platform.outer, platform.holes);
  } catch (cause) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["holes"],
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
});

const bossPitComponentSchema = z.object({
  kind: z.literal("bossPit"),
  name: nameSchema,
  boss: z.enum(["roshan", "miniboss", "custom"]),
  worldCenter: point3,
  tileCenter: point2,
  radius: z.number().finite().positive(),
  rimWidth: z.number().finite().positive().optional(),
  floorLevel: z.number().int(),
  rimLevel: z.number().int(),
  tileset: z.number().int().nonnegative().optional(),
  water: z.boolean().optional(),
  entrances: z.array(z.enum(["north", "east", "south", "west"])).optional(),
  entranceWidth: z.number().finite().positive().optional(),
  noWardsRadius: z.number().finite().positive().optional(),
  noWardsHeight: z.number().finite().positive().max(32768).optional(),
  noWardsSides: z.number().int().min(8).max(64).optional(),
}).strict().superRefine((pit, context) => {
  if (pit.floorLevel >= pit.rimLevel) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["floorLevel"],
      message: "floorLevel must be lower than rimLevel",
    });
  }
  if (new Set(pit.entrances ?? []).size !== (pit.entrances ?? []).length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["entrances"],
      message: "entrances must not contain duplicates",
    });
  }
  if (pit.noWardsRadius === undefined && (pit.noWardsHeight !== undefined || pit.noWardsSides !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [pit.noWardsHeight !== undefined ? "noWardsHeight" : "noWardsSides"],
      message: "requires noWardsRadius",
    });
  }
});

const baseTowerSchema = z.object({
  name: nameSchema,
  offset: point3,
  yaw: z.number().finite().optional(),
  tier: tierSchema,
  lane: laneSchema.optional(),
}).strict().superRefine((tower, context) => {
  if (tower.tier < 4 && !tower.lane) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lane"],
      message: "lane is required for tier 1-3 towers",
    });
  }
});

const baseOffsetSchema = z.object({
  name: nameSchema,
  offset: point3,
  yaw: z.number().finite().optional(),
}).strict();

const baseComponentSchema = z.object({
  kind: z.literal("base"),
  name: nameSchema,
  team: teamSchema,
  origin: point3,
  yaw: z.number().finite().optional(),
  ancientOffset: point3.optional(),
  fountain: baseOffsetSchema.optional(),
  shop: baseOffsetSchema.extend({
    shopType: z.enum(["home", "side", "secret", "custom"]).optional(),
  }).optional(),
  playerStarts: z.array(baseOffsetSchema).max(24).optional(),
  towers: z.array(baseTowerSchema).optional(),
  gates: z.array(baseOffsetSchema).optional(),
  blockers: z.array(baseOffsetSchema).optional(),
}).strict();

export const dotaComponentInputSchema = z.union([
  ancientComponentSchema,
  towerComponentSchema,
  fountainComponentSchema,
  shopComponentSchema,
  campComponentSchema,
  playerStartComponentSchema,
  gateComponentSchema,
  baseBlockerComponentSchema,
  fowBlockerComponentSchema,
  wallComponentSchema,
  staticPropSetComponentSchema,
  archComponentSchema,
  profileArchComponentSchema,
  bridgeComponentSchema,
  bridgeApproachComponentSchema,
  ringPlatformComponentSchema,
  holedPlatformComponentSchema,
  multiHoledPlatformComponentSchema,
  bossPitComponentSchema,
  baseComponentSchema,
]);

export type DotaComponentInput = z.infer<typeof dotaComponentInputSchema>;
type Team = z.infer<typeof teamSchema>;
type Point3 = [number, number, number];

export interface ExpandedDotaComponents {
  managedEntities: ManagedMapEntity[];
  managedTerrain: ManagedTerrainOperation[];
  managedSolids: ManagedMapSolid[];
  managedNavSurfaces: ManagedMapNavSurface[];
  managedVolumes: ManagedMapVolume[];
}

export const POINT_BLOCKER_RECIPES = {
  baseBlocker: {
    classname: "npc_dota_base_blocker",
    purpose: "Stock team-aware Dota base entrance blocker.",
    source: "Valve dota.fgd plus shipping dota_pvp_prefab.vmap instances",
  },
  fowBlockerNode: {
    classname: "ent_fow_blocker_node",
    purpose: "Fog-of-war blocker line linked to another named node through TargetNode.",
    source: "Valve dota.fgd plus shipping dota_pvp_prefab.vmap node groups",
  },
} as const;

export const WORLD_STRUCTURE_RECIPES = {
  staticPropSet: {
    parts: ["placement_*"],
    purpose: "Repeatable static scenery with a checked model path and required explicit collision intent.",
    source: "Valve prop_static FGD plus MCP model-asset preflight and collision inventory",
  },
  arch: {
    parts: ["left_post", "right_post", "lintel"],
    purpose: "Rectangular wall opening assembled from three checked always-solid func_brush extrusions.",
    source: "MCP composition of the Valve-compiler-proven managedSolids recipe",
  },
  profileArch: {
    parts: ["left_post", "right_post", "arch_segment_*"],
    purpose: "Irregular or curved-approximation opening assembled from checked posts and sloped overhead segments.",
    source: "MCP composition of the Valve-compiler-proven flat and per-corner-sloped managedSolids recipe",
  },
  bridge: {
    parts: ["deck", "walkable"],
    purpose: "Graybox bridge deck paired with Valve's dedicated invisible Dota navigation-walkable mesh.",
    source: "Installed dota_custom_default_000 and mine_bridge Valve prefabs",
  },
  bridgeApproach: {
    parts: ["ramp", "walkable"],
    purpose: "Sloped graybox bridge approach paired with exact Valve navigation-walkable geometry.",
    source: "MCP composition of compiler-proven sloped managedSolids and isolated real-GridNav-proven Valve navigation surfaces",
  },
  ringPlatform: {
    parts: ["segment_*_deck", "segment_*_walkable"],
    purpose: "Regular ring platform with a real central opening, composed from checked convex deck/navigation pairs.",
    source: "MCP composition of compiler-proven managedSolids and real-GridNav-proven Valve navigation surfaces",
  },
  holedPlatform: {
    parts: ["segment_*_deck", "segment_*_walkable"],
    purpose: "Irregular platform with a real paired-outline opening, composed from checked deck/navigation segments.",
    source: "MCP topology-validated composition of compiler-proven managedSolids and Valve navigation surfaces",
  },
  multiHoledPlatform: {
    parts: ["triangle_*_deck", "triangle_*_walkable"],
    purpose: "Platform with two to eight independent openings, emitted only after a conforming triangle partition is proven.",
    source: "Earcut candidate generation plus MCP boundary, manifold, area, overlap, T-junction, and connectivity proofs",
  },
} as const;

function normalizedNumber(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
}

function formatted(value: number): string {
  return String(normalizedNumber(value));
}

function originString(origin: Point3): string {
  return origin.map(formatted).join(" ");
}

function angleString(yaw = 0): string {
  const normalized = ((yaw % 360) + 360) % 360;
  return `0 ${formatted(normalized)} 0`;
}

function teamNumber(team: Team): number {
  return team === "radiant" ? 2 : 3;
}

function teamSide(team: Team): "goodguys" | "badguys" {
  return team === "radiant" ? "goodguys" : "badguys";
}

function teamBuildingProperties(team: Team): Record<string, string> {
  return {
    teamnumber: String(teamNumber(team)),
    direside: team === "dire" ? "1" : "0",
  };
}

function towerEntity(component: z.infer<typeof towerComponentSchema>): ManagedMapEntity {
  const side = teamSide(component.team);
  const tierSuffix = component.tier === 4
    ? "tower4"
    : `tower${component.tier}_${component.lane}`;
  return {
    targetname: component.name,
    classname: "npc_dota_tower",
    origin: originString(component.origin),
    angles: angleString(component.yaw),
    properties: {
      ...teamBuildingProperties(component.team),
      MapUnitName: `npc_dota_${side}_${tierSuffix}`,
      model:
        component.team === "radiant"
          ? "models/props_structures/radiant_tower002.vmdl"
          : "models/props_structures/dire_tower002.vmdl",
      solid: "0",
      invuln_count: String(component.invulnerabilityLinks ?? 0),
      vulnerableoncreepspawn: component.vulnerableOnCreepSpawn === false ? "0" : "1",
    },
  };
}

function ancientEntity(component: z.infer<typeof ancientComponentSchema>): ManagedMapEntity {
  const side = teamSide(component.team);
  return {
    targetname: component.name,
    classname: "npc_dota_fort",
    origin: originString(component.origin),
    angles: angleString(component.yaw),
    properties: {
      ...teamBuildingProperties(component.team),
      MapUnitName: `npc_dota_${side}_fort`,
      model:
        component.team === "radiant"
          ? "models/props_structures/radiant_ancient001.vmdl"
          : "models/props_structures/dire_ancient_base001.vmdl",
      solid: "0",
      invuln_count: String(component.invulnerabilityLinks ?? 0),
      vulnerableoncreepspawn: component.vulnerableOnCreepSpawn === false ? "0" : "1",
    },
  };
}

function fountainEntity(component: z.infer<typeof fountainComponentSchema>): ManagedMapEntity {
  return {
    targetname: component.name,
    classname: "ent_dota_fountain",
    origin: originString(component.origin),
    angles: angleString(component.yaw),
    properties: {
      ...teamBuildingProperties(component.team),
      MapUnitName: "dota_fountain",
      model:
        component.team === "radiant"
          ? "models/props_structures/radiant_fountain002.vmdl"
          : "models/props_structures/bad_fountain001.vmdl",
      solid: "6",
    },
  };
}

function shopEntity(component: z.infer<typeof shopComponentSchema>): ManagedMapEntity {
  const shopTypes = { home: 0, side: 1, secret: 2, custom: 6 } as const;
  return {
    targetname: component.name,
    classname: "ent_dota_shop",
    origin: originString(component.origin),
    angles: angleString(component.yaw),
    properties: {
      shoptype: String(shopTypes[component.shopType]),
      teamnumber: String(component.team ? teamNumber(component.team) : 0),
      ...(component.team ? { direside: component.team === "dire" ? "1" : "0" } : {}),
      ...(component.model ? { model: component.model } : {}),
      solid: "0",
    },
  };
}

function campEntity(component: z.infer<typeof campComponentSchema>): ManagedMapEntity {
  const neutralTypes = { small: 0, medium: 1, hard: 2, ancient: 3 } as const;
  return {
    targetname: component.name,
    classname: "npc_dota_neutral_spawner",
    origin: originString(component.origin),
    angles: angleString(component.yaw),
    properties: {
      NeutralType: String(neutralTypes[component.size]),
      VolumeName: component.volumeName,
      ForcedSubType: String(component.forcedSubtype ?? 0),
      PullType: String(component.pullType ?? 0),
      AggroType: String(component.aggroType ?? 0),
    },
  };
}

function campVolume(component: z.infer<typeof campComponentSchema>): ManagedMapVolume | undefined {
  if (!component.volume) return undefined;
  return {
    targetname: component.volumeName,
    recipe: "camp",
    center: component.volume.center ?? component.origin,
    size: component.volume.size,
    yaw: component.volume.yaw ?? component.yaw,
  };
}

function playerStartEntity(component: z.infer<typeof playerStartComponentSchema>): ManagedMapEntity {
  return {
    targetname: component.name,
    classname:
      component.team === "radiant"
        ? "info_player_start_goodguys"
        : "info_player_start_badguys",
    origin: originString(component.origin),
    angles: angleString(component.yaw),
    properties: component.disabled === undefined
      ? undefined
      : { Disabled: component.disabled ? "1" : "0" },
  };
}

function gateEntity(component: z.infer<typeof gateComponentSchema>): ManagedMapEntity {
  return {
    targetname: component.name,
    classname: "npc_dota_unit_twin_gate",
    origin: originString(component.origin),
    angles: angleString(component.yaw),
    properties: {
      ...teamBuildingProperties(component.team),
      solid: "0",
    },
  };
}

function baseBlockerEntity(component: z.infer<typeof baseBlockerComponentSchema>): ManagedMapEntity {
  return {
    targetname: component.name,
    classname: POINT_BLOCKER_RECIPES.baseBlocker.classname,
    origin: originString(component.origin),
    angles: angleString(component.yaw),
    properties: {
      teamnumber: String(teamNumber(component.team)),
      direside: "0",
      solid: "6",
      model: "",
      MapUnitName: "",
      vulnerableoncreepspawn: "0",
    },
  };
}

function fowBlockerEntities(component: z.infer<typeof fowBlockerComponentSchema>): ManagedMapEntity[] {
  return component.points.map((origin, index) => {
    const nextIndex = index + 1 < component.points.length
      ? index + 1
      : component.closed
        ? 0
        : undefined;
    return {
      targetname: `${component.name}_${index + 1}`,
      classname: POINT_BLOCKER_RECIPES.fowBlockerNode.classname,
      origin: originString(origin),
      angles: "0 0 0",
      properties: nextIndex === undefined
        ? undefined
        : { TargetNode: `${component.name}_${nextIndex + 1}` },
      removeProperties: nextIndex === undefined ? ["TargetNode"] : undefined,
    };
  });
}

function wallVolumes(component: z.infer<typeof wallComponentSchema>): ManagedMapVolume[] {
  const pairs: Array<[Point3, Point3]> = [];
  for (let index = 0; index < component.points.length - 1; index++) {
    pairs.push([component.points[index], component.points[index + 1]]);
  }
  if (component.closed && component.points.length > 2) {
    pairs.push([component.points[component.points.length - 1], component.points[0]]);
  }
  const overlap = component.overlap ?? Math.min(component.thickness * 0.25, 64);
  return pairs.map(([from, to], index) => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    return {
      targetname: `${component.name}_${index + 1}`,
      recipe: "playerClip",
      center: [
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2,
        from[2] + component.height / 2,
      ],
      size: [length + overlap, component.thickness, component.height],
      yaw: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  });
}

function archSolids(component: z.infer<typeof archComponentSchema>): ManagedMapSolid[] {
  const postWidth = (component.width - component.openingWidth) / 2;
  const lintelHeight = component.height - component.openingHeight;
  const yaw = component.yaw ?? 0;
  const at = (localX: number, localZ: number): Point3 =>
    addPoint(component.origin, rotateOffset([localX, 0, localZ], yaw))
      .map((value) => Number(formatted(value))) as Point3;
  const rectangle = (width: number): [number, number][] => [
    [-width / 2, -component.depth / 2],
    [width / 2, -component.depth / 2],
    [width / 2, component.depth / 2],
    [-width / 2, component.depth / 2],
  ];
  const postOffset = component.openingWidth / 2 + postWidth / 2;
  return [
    {
      targetname: `${component.name}_left_post`,
      center: at(-postOffset, component.openingHeight / 2),
      yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion: { points: rectangle(postWidth), height: component.openingHeight },
    },
    {
      targetname: `${component.name}_right_post`,
      center: at(postOffset, component.openingHeight / 2),
      yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion: { points: rectangle(postWidth), height: component.openingHeight },
    },
    {
      targetname: `${component.name}_lintel`,
      center: at(0, component.openingHeight + lintelHeight / 2),
      yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion: { points: rectangle(component.width), height: lintelHeight },
    },
  ];
}

function profileArchSolids(component: z.infer<typeof profileArchComponentSchema>): ManagedMapSolid[] {
  const yaw = component.yaw ?? 0;
  const at = (localX: number, localZ: number): Point3 =>
    addPoint(component.origin, rotateOffset([localX, 0, localZ], yaw))
      .map((value) => Number(formatted(value))) as Point3;
  const rectangle = (width: number): [number, number][] => [
    [-width / 2, -component.depth / 2],
    [width / 2, -component.depth / 2],
    [width / 2, component.depth / 2],
    [-width / 2, component.depth / 2],
  ];
  const outerLeft = -component.width / 2;
  const outerRight = component.width / 2;
  const profileLeft = component.profile[0][0];
  const profileRight = component.profile[component.profile.length - 1][0];
  const leftWidth = profileLeft - outerLeft;
  const rightWidth = outerRight - profileRight;
  const solids: ManagedMapSolid[] = [
    {
      targetname: `${component.name}_left_post`,
      center: at((outerLeft + profileLeft) / 2, component.height / 2),
      yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion: { points: rectangle(leftWidth), height: component.height },
    },
    {
      targetname: `${component.name}_right_post`,
      center: at((profileRight + outerRight) / 2, component.height / 2),
      yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion: { points: rectangle(rightWidth), height: component.height },
    },
  ];
  for (let index = 0; index < component.profile.length - 1; index++) {
    const [startX, startZ] = component.profile[index];
    const [endX, endZ] = component.profile[index + 1];
    const width = endX - startX;
    const segment = String(index + 1).padStart(2, "0");
    solids.push({
      targetname: `${component.name}_arch_segment_${segment}`,
      center: at((startX + endX) / 2, component.height / 2),
      yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion: {
        points: rectangle(width),
        bottom: [
          startZ - component.height / 2,
          endZ - component.height / 2,
          endZ - component.height / 2,
          startZ - component.height / 2,
        ],
        top: Array(4).fill(component.height / 2),
      },
    });
  }
  return solids;
}

function bridgeParts(component: z.infer<typeof bridgeComponentSchema>): {
  solid: ManagedMapSolid;
  navSurface: ManagedMapNavSurface;
} {
  const points: [number, number][] = [
    [-component.length / 2, -component.width / 2],
    [component.length / 2, -component.width / 2],
    [component.length / 2, component.width / 2],
    [-component.length / 2, component.width / 2],
  ];
  const extrusion = { points, height: component.thickness };
  return {
    solid: {
      targetname: `${component.name}_deck`,
      center: component.center,
      yaw: component.yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion,
    },
    navSurface: {
      targetname: `${component.name}_walkable`,
      center: component.center,
      yaw: component.yaw,
      extrusion,
    },
  };
}

function bridgeApproachParts(component: z.infer<typeof bridgeApproachComponentSchema>): {
  solid: ManagedMapSolid;
  navSurface: ManagedMapNavSurface;
} {
  const dx = component.end[0] - component.start[0];
  const dy = component.end[1] - component.start[1];
  const length = Math.hypot(dx, dy);
  const center: [number, number, number] = [
    (component.start[0] + component.end[0]) / 2,
    (component.start[1] + component.end[1]) / 2,
    (component.start[2] + component.end[2]) / 2,
  ];
  const startTop = component.start[2] - center[2];
  const endTop = component.end[2] - center[2];
  const points: [number, number][] = [
    [-length / 2, -component.width / 2],
    [length / 2, -component.width / 2],
    [length / 2, component.width / 2],
    [-length / 2, component.width / 2],
  ];
  const extrusion = {
    points,
    bottom: [
      startTop - component.thickness,
      endTop - component.thickness,
      endTop - component.thickness,
      startTop - component.thickness,
    ],
    top: [startTop, endTop, endTop, startTop],
  };
  const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
  return {
    solid: {
      targetname: `${component.name}_ramp`,
      center,
      yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion,
    },
    navSurface: {
      targetname: `${component.name}_walkable`,
      center,
      yaw,
      extrusion,
    },
  };
}

function pairedOutlinePlatformParts(component: {
  name: string;
  center: Point3;
  yaw?: number;
  outer: [number, number][];
  hole: [number, number][];
  height: number;
  material: string;
  faceMaterials?: { top?: string; bottom?: string };
  faceTextureScales?: ManagedMapSolidFaceTextureScales;
  faceTextureShifts?: ManagedMapSolidFaceTextureShifts;
  faceTextureRotations?: ManagedMapSolidFaceTextureRotations;
  faceTextureAlignments?: ManagedMapSolidFaceTextureAlignments;
}): {
  solids: ManagedMapSolid[];
  navSurfaces: ManagedMapNavSurface[];
} {
  const { outer, hole } = pairedPlatformOutlines(component.outer, component.hole);
  const solids: ManagedMapSolid[] = [];
  const navSurfaces: ManagedMapNavSurface[] = [];
  for (let index = 0; index < outer.length; index++) {
    const next = (index + 1) % outer.length;
    const segment = String(index + 1).padStart(2, "0");
    const extrusion = {
      points: [outer[index], outer[next], hole[next], hole[index]] as [number, number][],
      height: component.height,
    };
    solids.push({
      targetname: `${component.name}_segment_${segment}_deck`,
      center: component.center,
      yaw: component.yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion,
    });
    navSurfaces.push({
      targetname: `${component.name}_segment_${segment}_walkable`,
      center: component.center,
      yaw: component.yaw,
      extrusion,
    });
  }
  return { solids, navSurfaces };
}

function ringPlatformParts(component: z.infer<typeof ringPlatformComponentSchema>): {
  solids: ManagedMapSolid[];
  navSurfaces: ManagedMapNavSurface[];
} {
  const sides = component.sides ?? 16;
  return pairedOutlinePlatformParts({
    name: component.name,
    center: component.center,
    yaw: component.yaw,
    outer: regularPolygonFootprint(component.outerRadius, sides),
    hole: regularPolygonFootprint(component.innerRadius, sides),
    height: component.height,
    material: component.material,
    faceMaterials: component.faceMaterials,
    faceTextureScales: component.faceTextureScales,
    faceTextureShifts: component.faceTextureShifts,
    faceTextureRotations: component.faceTextureRotations,
    faceTextureAlignments: component.faceTextureAlignments,
  });
}

function holedPlatformParts(component: z.infer<typeof holedPlatformComponentSchema>): {
  solids: ManagedMapSolid[];
  navSurfaces: ManagedMapNavSurface[];
} {
  return pairedOutlinePlatformParts(component);
}

function multiHoledPlatformParts(component: z.infer<typeof multiHoledPlatformComponentSchema>): {
  solids: ManagedMapSolid[];
  navSurfaces: ManagedMapNavSurface[];
} {
  const partition = partitionPolygonWithHoles(component.outer, component.holes);
  const solids: ManagedMapSolid[] = [];
  const navSurfaces: ManagedMapNavSurface[] = [];
  for (const [index, triangle] of partition.triangles.entries()) {
    const suffix = String(index + 1).padStart(3, "0");
    const extrusion = {
      points: triangle.map((vertex) => partition.points[vertex]) as [number, number][],
      height: component.height,
    };
    solids.push({
      targetname: `${component.name}_triangle_${suffix}_deck`,
      center: component.center,
      yaw: component.yaw,
      material: component.material,
      ...(component.faceMaterials ? { faceMaterials: component.faceMaterials } : {}),
      ...(component.faceTextureScales ? { faceTextureScales: component.faceTextureScales } : {}),
      ...(component.faceTextureShifts ? { faceTextureShifts: component.faceTextureShifts } : {}),
      ...(component.faceTextureRotations ? { faceTextureRotations: component.faceTextureRotations } : {}),
      ...(component.faceTextureAlignments ? { faceTextureAlignments: component.faceTextureAlignments } : {}),
      extrusion,
    });
    navSurfaces.push({
      targetname: `${component.name}_triangle_${suffix}_walkable`,
      center: component.center,
      yaw: component.yaw,
      extrusion,
    });
  }
  return { solids, navSurfaces };
}

function pitOperations(component: z.infer<typeof bossPitComponentSchema>): ExpandedDotaComponents {
  const [cx, cy] = component.tileCenter;
  const rimWidth = component.rimWidth ?? 1.5;
  const spawnClass = component.boss === "roshan"
    ? "npc_dota_roshan_spawner"
    : component.boss === "miniboss"
      ? "npc_dota_miniboss_spawner"
      : "info_target";
  const managedEntities: ManagedMapEntity[] = [
    {
      targetname: `${component.name}_spawn`,
      classname: spawnClass,
      origin: originString(component.worldCenter),
      angles: "0 0 0",
      properties:
        component.boss === "miniboss"
          ? { teamnumber: "4", VisualTeam: "4" }
          : component.boss === "custom"
            ? { comment: "Custom boss spawn marker" }
            : undefined,
    },
  ];
  const managedVolumes: ManagedMapVolume[] = [];
  if (component.noWardsRadius !== undefined) {
    const height = component.noWardsHeight ?? 1024;
    managedVolumes.push({
      targetname: `${component.name}_no_wards`,
      recipe: "noWards",
      center: [component.worldCenter[0], component.worldCenter[1], component.worldCenter[2] + height / 2],
      polygon: {
        points: regularPolygonFootprint(component.noWardsRadius, component.noWardsSides ?? 32, true),
        height,
      },
    });
  }
  const managedTerrain: ManagedTerrainOperation[] = [
    {
      op: "height",
      level: component.rimLevel,
      shape: {
        kind: "ring",
        cx,
        cy,
        rInner: component.radius,
        rOuter: component.radius + rimWidth,
      },
    },
    {
      op: "height",
      level: component.floorLevel,
      shape: { kind: "circle", cx, cy, r: component.radius },
    },
    {
      op: "water",
      on: component.water === true,
      shape: { kind: "circle", cx, cy, r: component.radius },
    },
  ];
  if (component.tileset !== undefined) {
    managedTerrain.push({
      op: "tileset",
      tileset: component.tileset,
      shape: { kind: "circle", cx, cy, r: component.radius + rimWidth },
    });
  }
  const directions = {
    north: [0, 1],
    east: [1, 0],
    south: [0, -1],
    west: [-1, 0],
  } as const;
  for (const entrance of component.entrances ?? []) {
    const [dx, dy] = directions[entrance];
    managedTerrain.push({
      op: "ramp",
      shape: {
        kind: "path",
        points: [
          [cx + dx * (component.radius + rimWidth + 1), cy + dy * (component.radius + rimWidth + 1)],
          [cx + dx * (component.radius - 1), cy + dy * (component.radius - 1)],
        ],
        width: component.entranceWidth ?? 2.5,
      },
    });
  }
  return { managedEntities, managedTerrain, managedSolids: [], managedNavSurfaces: [], managedVolumes };
}

function rotateOffset(offset: Point3, yaw: number): Point3 {
  const radians = (yaw * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    offset[0] * cos - offset[1] * sin,
    offset[0] * sin + offset[1] * cos,
    offset[2],
  ];
}

function addPoint(a: Point3, b: Point3): Point3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function expandStaticPropSet(
  component: z.infer<typeof staticPropSetComponentSchema>,
): ManagedMapEntity[] {
  const yaw = component.yaw ?? 0;
  return component.placements.map((placement) => ({
    targetname: `${component.name}_${placement.name}`,
    classname: "prop_static",
    origin: originString(addPoint(component.origin, rotateOffset(placement.offset, yaw))),
    angles: angleString(yaw + (placement.yaw ?? 0)),
    properties: {
      model: component.model,
      solid: component.collision === "vphysics" ? "6" : "0",
      ...(component.castShadows === undefined
        ? {}
        : { disableshadows: component.castShadows ? "0" : "1" }),
      ...(component.tint ? { rendercolor: component.tint.join(" ") } : {}),
    },
  }));
}

function expandBase(component: z.infer<typeof baseComponentSchema>): ManagedMapEntity[] {
  const yaw = component.yaw ?? 0;
  const at = (offset: Point3): Point3 => addPoint(component.origin, rotateOffset(offset, yaw));
  const entities: ManagedMapEntity[] = [
    ancientEntity({
      kind: "ancient",
      name: `${component.name}_ancient`,
      team: component.team,
      origin: at(component.ancientOffset ?? [0, 0, 0]),
      yaw,
    }),
  ];
  if (component.fountain) {
    entities.push(fountainEntity({
      kind: "fountain",
      name: `${component.name}_${component.fountain.name}`,
      team: component.team,
      origin: at(component.fountain.offset),
      yaw: yaw + (component.fountain.yaw ?? 0),
    }));
  }
  if (component.shop) {
    entities.push(shopEntity({
      kind: "shop",
      name: `${component.name}_${component.shop.name}`,
      team: component.team,
      origin: at(component.shop.offset),
      yaw: yaw + (component.shop.yaw ?? 0),
      shopType: component.shop.shopType ?? "home",
    }));
  }
  for (const start of component.playerStarts ?? []) {
    entities.push(playerStartEntity({
      kind: "playerStart",
      name: `${component.name}_${start.name}`,
      team: component.team,
      origin: at(start.offset),
      yaw: yaw + (start.yaw ?? 0),
    }));
  }
  for (const tower of component.towers ?? []) {
    entities.push(towerEntity({
      kind: "tower",
      name: `${component.name}_${tower.name}`,
      team: component.team,
      origin: at(tower.offset),
      yaw: yaw + (tower.yaw ?? 0),
      tier: tower.tier,
      lane: tower.lane,
    }));
  }
  for (const gate of component.gates ?? []) {
    entities.push(gateEntity({
      kind: "gate",
      name: `${component.name}_${gate.name}`,
      team: component.team,
      origin: at(gate.offset),
      yaw: yaw + (gate.yaw ?? 0),
      gateType: "twin",
    }));
  }
  for (const blocker of component.blockers ?? []) {
    entities.push(baseBlockerEntity({
      kind: "baseBlocker",
      name: `${component.name}_${blocker.name}`,
      team: component.team,
      origin: at(blocker.offset),
      yaw: yaw + (blocker.yaw ?? 0),
    }));
  }
  return entities;
}

export function expandDotaComponents(components: DotaComponentInput[]): ExpandedDotaComponents {
  const managedEntities: ManagedMapEntity[] = [];
  const managedTerrain: ManagedTerrainOperation[] = [];
  const managedSolids: ManagedMapSolid[] = [];
  const managedNavSurfaces: ManagedMapNavSurface[] = [];
  const managedVolumes: ManagedMapVolume[] = [];
  for (const component of components) {
    switch (component.kind) {
      case "ancient":
        managedEntities.push(ancientEntity(component));
        break;
      case "tower":
        managedEntities.push(towerEntity(component));
        break;
      case "fountain":
        managedEntities.push(fountainEntity(component));
        break;
      case "shop":
        managedEntities.push(shopEntity(component));
        break;
      case "camp":
        managedEntities.push(campEntity(component));
        if (component.volume) managedVolumes.push(campVolume(component)!);
        break;
      case "playerStart":
        managedEntities.push(playerStartEntity(component));
        break;
      case "gate":
        managedEntities.push(gateEntity(component));
        break;
      case "baseBlocker":
        managedEntities.push(baseBlockerEntity(component));
        break;
      case "fowBlocker":
        managedEntities.push(...fowBlockerEntities(component));
        break;
      case "wall":
        managedVolumes.push(...wallVolumes(component));
        break;
      case "staticPropSet":
        managedEntities.push(...expandStaticPropSet(component));
        break;
      case "arch":
        managedSolids.push(...archSolids(component));
        break;
      case "profileArch":
        managedSolids.push(...profileArchSolids(component));
        break;
      case "bridge": {
        const bridge = bridgeParts(component);
        managedSolids.push(bridge.solid);
        managedNavSurfaces.push(bridge.navSurface);
        break;
      }
      case "bridgeApproach": {
        const approach = bridgeApproachParts(component);
        managedSolids.push(approach.solid);
        managedNavSurfaces.push(approach.navSurface);
        break;
      }
      case "ringPlatform": {
        const platform = ringPlatformParts(component);
        managedSolids.push(...platform.solids);
        managedNavSurfaces.push(...platform.navSurfaces);
        break;
      }
      case "holedPlatform": {
        const platform = holedPlatformParts(component);
        managedSolids.push(...platform.solids);
        managedNavSurfaces.push(...platform.navSurfaces);
        break;
      }
      case "multiHoledPlatform": {
        const platform = multiHoledPlatformParts(component);
        managedSolids.push(...platform.solids);
        managedNavSurfaces.push(...platform.navSurfaces);
        break;
      }
      case "bossPit": {
        const pit = pitOperations(component);
        managedEntities.push(...pit.managedEntities);
        managedTerrain.push(...pit.managedTerrain);
        managedVolumes.push(...pit.managedVolumes);
        break;
      }
      case "base":
        managedEntities.push(...expandBase(component));
        break;
    }
  }
  return { managedEntities, managedTerrain, managedSolids, managedNavSurfaces, managedVolumes };
}
