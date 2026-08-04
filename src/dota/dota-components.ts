import { z } from "zod";
import { ManagedMapEntity } from "./map-contract.js";
import { ManagedTerrainOperation } from "./map-terrain.js";
import { ManagedMapVolume } from "./map-volume.js";

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
  bossPitComponentSchema,
  baseComponentSchema,
]);

export type DotaComponentInput = z.infer<typeof dotaComponentInputSchema>;
type Team = z.infer<typeof teamSchema>;
type Point3 = [number, number, number];

export interface ExpandedDotaComponents {
  managedEntities: ManagedMapEntity[];
  managedTerrain: ManagedTerrainOperation[];
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

function formatted(value: number): string {
  return String(Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6)));
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
  if (component.noWardsRadius !== undefined) {
    managedEntities.push({
      targetname: `${component.name}_no_wards_marker`,
      classname: "info_target",
      origin: originString(component.worldCenter),
      angles: "0 0 0",
      properties: {
        radius: formatted(component.noWardsRadius),
        comment: "Marker for a future solid trigger_no_wards volume",
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
  return { managedEntities, managedTerrain, managedVolumes: [] };
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
  return { managedEntities, managedTerrain, managedVolumes };
}
