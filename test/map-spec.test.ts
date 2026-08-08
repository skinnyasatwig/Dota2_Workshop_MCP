import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseMapSpecification,
  reconcileMapSpecification,
} from "../src/dota/map-spec.js";
import { parseMapEntities } from "../src/dota/vmap.js";

const EMPTY_MAP = `<!-- dmx encoding keyvalues2 1 format vmap 35 -->
"world" "CMapWorld"
{
	"id" "elementid" "00000000-0000-0000-0000-000000000001"
	"children" "element_array" [ ]
}
`;

test("the documented map specification example stays valid", async () => {
  const path = new URL("../examples/map-specification.json", import.meta.url);
  const specification = parseMapSpecification(
    JSON.parse(await readFile(path, "utf8")),
    path.pathname,
  );

  assert.equal(specification.map, "example_arena");
  assert.equal(specification.managedPaths?.length, 2);
  assert.equal(specification.managedTerrain?.length, 3);
  assert.equal(specification.managedSolids?.length, 12);
  assert.equal(specification.managedNavSurfaces?.length, 8);
  assert.equal(
    specification.managedEntities?.find((entity) => entity.targetname === "radiant_watch_platform_start")
      ?.classname,
    "info_player_start_goodguys",
  );
  assert.equal(
    specification.managedEntities?.find((entity) => entity.targetname === "dire_watch_platform_start")
      ?.classname,
    "info_player_start_badguys",
  );
});

test("parseMapSpecification exposes the contract terrain and path vocabulary", () => {
  const specification = parseMapSpecification({
    map: "test_map",
    managedEntities: [
      {
        targetname: "radiant_fort",
        classname: "npc_dota_fort",
        origin: "-1024 0 128",
        properties: { teamnumber: 2, enabled: true },
      },
    ],
    managedPaths: [
      {
        name: "north_route",
        points: [[-512, 256, 128], [512, 256, 128]],
      },
      {
        name: "south_route",
        mirrorOf: "north_route",
        mirrorAxis: "y",
        points: [[-512, -256, 128], [512, -256, 128]],
      },
    ],
    managedTerrain: [
      {
        op: "height",
        level: 1,
        shape: { kind: "polygon", points: [[4, 4], [12, 4], [8, 12]] },
      },
      {
        op: "ramp",
        shape: { kind: "managedPath", name: "north_route", width: 2 },
      },
    ],
    managedVolumes: [
      {
        targetname: "river_no_wards",
        recipe: "noWards",
        center: [0, 0, 256],
        size: [1024, 512, 512],
      },
    ],
  });

  assert.deepEqual(specification.requiredEntities, []);
  assert.equal(specification.managedEntities?.[0].properties?.teamnumber, "2");
  assert.equal(specification.managedEntities?.[0].properties?.enabled, "true");
  assert.equal(specification.managedTerrain?.[0].op, "height");
  assert.equal(specification.managedTerrain?.[1].op, "ramp");
  assert.equal(specification.managedVolumes?.[0].recipe, "noWards");
});

test("parseMapSpecification rejects unresolved managedPath terrain", () => {
  assert.throws(
    () =>
      parseMapSpecification({
        managedTerrain: [
          {
            op: "tileset",
            tileset: 1,
            shape: { kind: "managedPath", name: "missing", width: 2 },
          },
        ],
      }),
    /references missing managedPath "missing"/,
  );
});

test("reconcileMapSpecification applies entities, paths, solids, and volumes idempotently", () => {
  const specification = parseMapSpecification({
    managedEntities: [
      {
        targetname: "objective",
        classname: "info_target",
        origin: "0 0 128",
      },
    ],
    managedPaths: [
      {
        name: "creep_route",
        points: [[-256, 0, 128], [256, 0, 128]],
      },
    ],
    managedVolumes: [
      {
        targetname: "objective_bounds",
        recipe: "heroTrigger",
        center: [0, 0, 128],
        size: [512, 512, 256],
      },
    ],
    managedSolids: [{
      targetname: "objective_wall",
      center: [0, 512, 128],
      material: "materials/dev/reflectivity_30.vmat",
      extrusion: {
        points: [[-256, -64], [256, -64], [256, 64], [0, 64], [0, 192], [-256, 192]],
        height: 256,
      },
    }],
  });

  const first = reconcileMapSpecification(EMPTY_MAP, specification);
  assert.equal(first.changed, true);
  assert.deepEqual(first.entities.added, ["objective", "creep_route_1", "creep_route_2"]);
  assert.deepEqual(first.solids.added, ["objective_wall"]);
  assert.deepEqual(first.volumes.added, ["objective_bounds"]);
  assert.equal(parseMapEntities(first.text).length, 5);

  const second = reconcileMapSpecification(first.text, specification);
  assert.equal(second.changed, false);
  assert.deepEqual(second.entities.unchanged, ["objective", "creep_route_1", "creep_route_2"]);
  assert.deepEqual(second.solids.unchanged, ["objective_wall"]);
  assert.deepEqual(second.volumes.unchanged, ["objective_bounds"]);
});

test("component placements namespace and mirror asymmetric concave solids", () => {
  const specification = parseMapSpecification({
    components: {
      base_wall: {
        managedSolids: [{
          targetname: "wall",
          center: [100, 200, 64],
          yaw: 30,
          material: "materials/dev/reflectivity_30.vmat",
          faceTextureScales: { top: [0.25, 0.25], sides: [-0.5, 1] },
          faceTextureShifts: { top: [0, 64], sides: [16, -16] },
          faceTextureRotations: { top: 45, sides: -90 },
          faceTextureAlignments: { top: "shared", sides: "shared" },
          extrusion: {
            points: [[-200, -100], [200, -100], [200, 0], [0, 0], [0, 200], [-200, 200]],
            height: 128,
          },
          properties: { OnUser1: "@local:tower,Disable,,0,-1" },
        }],
      },
    },
    placements: [
      { component: "base_wall", name: "west", worldOffset: [-1000, 0, 128] },
      { component: "base_wall", name: "east", worldOffset: [1000, 0, 128], mirrorAxis: "x" },
    ],
  });
  assert.deepEqual(specification.managedSolids, [
    {
      targetname: "west_wall",
      center: [-900, 200, 192],
      yaw: 30,
      material: "materials/dev/reflectivity_30.vmat",
      faceTextureScales: { top: [0.25, 0.25], sides: [-0.5, 1] },
      faceTextureShifts: { top: [0, 64], sides: [16, -16] },
      faceTextureRotations: { top: 45, sides: -90 },
      faceTextureAlignments: { top: "shared", sides: "shared" },
      extrusion: {
        points: [[-200, -100], [200, -100], [200, 0], [0, 0], [0, 200], [-200, 200]],
        height: 128,
      },
      properties: { OnUser1: "west_tower,Disable,,0,-1" },
    },
    {
      targetname: "east_wall",
      center: [900, 200, 192],
      yaw: 150,
      material: "materials/dev/reflectivity_30.vmat",
      faceTextureScales: { top: [0.25, 0.25], sides: [-0.5, 1] },
      faceTextureShifts: { top: [0, 64], sides: [16, -16] },
      faceTextureRotations: { top: 45, sides: -90 },
      faceTextureAlignments: { top: "shared", sides: "shared" },
      extrusion: {
        points: [[-200, -200], [0, -200], [0, 0], [200, 0], [200, 100], [-200, 100]],
        height: 128,
      },
      properties: { OnUser1: "east_tower,Disable,,0,-1" },
    },
  ]);
});

test("mirrored sloped concave solids keep height rings paired with their outline", () => {
  const specification = parseMapSpecification({
    components: {
      sloped_wall: {
        managedSolids: [{
          targetname: "wall",
          center: [0, 0, 128],
          material: "materials/dev/reflectivity_30.vmat",
          extrusion: {
            points: [[-200, -100], [200, -100], [200, 0], [0, 0], [0, 200], [-200, 200]],
            bottom: [-192, -64, -64, -128, -256, -256],
            top: [64, 192, 192, 128, 0, 0],
          },
        }],
      },
    },
    placements: [{ component: "sloped_wall", name: "east", mirrorAxis: "x" }],
  });
  assert.deepEqual(specification.managedSolids?.[0].extrusion, {
    points: [[-200, -200], [0, -200], [0, 0], [200, 0], [200, 100], [-200, 100]],
    bottom: [-256, -256, -128, -64, -64, -192],
    top: [0, 0, 128, 192, 192, 64],
  });
});

test("mirrored sloped navigation surfaces keep height rings paired with their outline", () => {
  const specification = parseMapSpecification({
    components: {
      sloped_bridge: {
        managedNavSurfaces: [{
          targetname: "walkable",
          center: [300, 50, 256],
          yaw: 20,
          extrusion: {
            points: [[-200, -100], [200, -100], [200, 100], [-200, 100]],
            bottom: [-96, 32, 32, -96],
            top: [-32, 96, 96, -32],
          },
        }],
      },
    },
    placements: [{
      component: "sloped_bridge",
      name: "east",
      worldOffset: [1000, 0, 128],
      mirrorAxis: "x",
    }],
  });
  assert.deepEqual(specification.managedNavSurfaces, [{
    targetname: "east_walkable",
    center: [700, 50, 384],
    yaw: 160,
    extrusion: {
      points: [[-200, -100], [200, -100], [200, 100], [-200, 100]],
      bottom: [-96, 32, 32, -96],
      top: [-32, 96, 96, -32],
    },
  }]);
});

test("named regions can be reused and mirrored around a chosen tile point", () => {
  const specification = parseMapSpecification({
    regions: {
      west_platform: {
        shape: { kind: "rect", x0: 2, y0: 4, x1: 6, y1: 10 },
      },
      east_platform: {
        mirrorOf: "west_platform",
        mirrorAxis: "x",
        around: [16, 16],
      },
    },
    managedTerrain: [
      { op: "height", level: 1, shape: { kind: "region", name: "west_platform" } },
      { op: "height", level: 1, shape: { kind: "region", name: "east_platform" } },
    ],
  });

  assert.deepEqual(specification.managedTerrain, [
    { op: "height", level: 1, dome: undefined, shape: { kind: "rect", x0: 2, y0: 4, x1: 6, y1: 10 } },
    { op: "height", level: 1, dome: undefined, shape: { kind: "rect", x0: 26, y0: 4, x1: 30, y1: 10 } },
  ]);
});

test("reusable component definitions expand, namespace, and mirror checked Dota recipes", () => {
  const specification = parseMapSpecification({
    components: {
      neutral_objective_kit: {
        dotaComponents: [
          {
            kind: "camp",
            name: "camp",
            origin: [100, 200, 128],
            size: "medium",
            volumeName: "camp_bounds",
            volume: { center: [100, 200, 192], size: [512, 384, 384] },
          },
          {
            kind: "fowBlocker",
            name: "fog",
            points: [[0, -256, 128], [0, 256, 128]],
          },
          {
            kind: "bridgeApproach",
            name: "approach",
            start: [-512, 0, 128],
            end: [0, 0, 384],
            width: 384,
            thickness: 64,
            material: "materials/dev/reflectivity_30.vmat",
          },
          {
            kind: "bossPit",
            name: "pit",
            boss: "custom",
            worldCenter: [0, 512, 128],
            tileCenter: [0, 2],
            radius: 2,
            rimWidth: 1,
            floorLevel: -1,
            rimLevel: 0,
            tileset: 1,
            entrances: ["east"],
            entranceWidth: 1,
            noWardsRadius: 256,
            noWardsSides: 8,
            noWardsHeight: 512,
          },
        ],
      },
    },
    placements: [
      {
        component: "neutral_objective_kit",
        name: "west",
        worldOffset: [-2000, 0, 0],
        tileOffset: [8, 8],
      },
      {
        component: "neutral_objective_kit",
        name: "east",
        worldOffset: [2000, 0, 0],
        tileOffset: [24, 8],
        mirrorAxis: "x",
      },
    ],
  });

  const westCamp = specification.managedEntities?.find((entity) => entity.targetname === "west_camp");
  const eastCamp = specification.managedEntities?.find((entity) => entity.targetname === "east_camp");
  assert.equal(westCamp?.origin, "-1900 200 128");
  assert.equal(westCamp?.properties?.VolumeName, "west_camp_bounds");
  assert.equal(eastCamp?.origin, "1900 200 128");
  assert.equal(eastCamp?.properties?.VolumeName, "east_camp_bounds");
  assert.equal(
    specification.managedEntities?.find((entity) => entity.targetname === "west_fog_1")
      ?.properties?.TargetNode,
    "west_fog_2",
  );
  assert.equal(
    specification.managedEntities?.find((entity) => entity.targetname === "east_fog_1")
      ?.properties?.TargetNode,
    "east_fog_2",
  );
  assert.equal(
    specification.managedEntities?.find((entity) => entity.targetname === "west_pit_spawn")?.origin,
    "-2000 512 128",
  );
  assert.equal(
    specification.managedEntities?.find((entity) => entity.targetname === "east_pit_spawn")?.origin,
    "2000 512 128",
  );
  assert.deepEqual(specification.managedSolids?.map((solid) => [solid.targetname, solid.center, solid.yaw]), [
    ["west_approach_ramp", [-2256, 0, 256], 0],
    ["east_approach_ramp", [2256, 0, 256], 180],
  ]);
  assert.deepEqual(specification.managedNavSurfaces?.map((surface) => surface.targetname), [
    "west_approach_walkable",
    "east_approach_walkable",
  ]);
  assert.deepEqual(specification.managedVolumes?.map((volume) => volume.targetname), [
    "west_camp_bounds",
    "west_pit_no_wards",
    "east_camp_bounds",
    "east_pit_no_wards",
  ]);
  assert.equal(specification.managedTerrain?.length, 10);
  assert.deepEqual(specification.managedTerrain?.[0]?.shape, {
    kind: "ring", cx: 8, cy: 10, rInner: 2, rOuter: 3,
  });
  assert.deepEqual(specification.managedTerrain?.[5]?.shape, {
    kind: "ring", cx: 24, cy: 10, rInner: 2, rOuter: 3,
  });
});

test("nested reusable components compose transforms, references, terrain, and team identity", () => {
  const specification = parseMapSpecification({
    components: {
      base_core: {
        managedEntities: [
          {
            targetname: "controller",
            classname: "info_target",
            origin: "0 256 128",
            properties: { target: "@local:route_1" },
          },
        ],
        managedPaths: [{ name: "route", points: [[0, 0, 128], [512, 0, 128]] }],
        managedTerrain: [{
          op: "height",
          level: 1,
          shape: { kind: "rect", x0: 0, y0: 0, x1: 1, y1: 1 },
        }],
        managedVolumes: [{
          targetname: "bounds",
          recipe: "heroTrigger",
          center: [0, 0, 256],
          size: [512, 512, 512],
          properties: { OnUser1: "@local:controller,Enable,,0,-1" },
        }],
        dotaComponents: [
          {
            kind: "camp",
            name: "camp",
            origin: [0, -256, 128],
            size: "small",
            volumeName: "camp_bounds",
            volume: { size: [384, 384, 384] },
          },
          {
            kind: "base",
            name: "base",
            team: "radiant",
            origin: [0, 0, 128],
            playerStarts: [{ name: "start", offset: [-512, 0, 0] }],
            towers: [{ name: "mid_t2", offset: [512, 0, 0], tier: 2, lane: "mid" }],
          },
        ],
      },
      complete_base: {
        placements: [{
          component: "base_core",
          name: "core",
          worldOffset: [256, 0, 0],
          tileOffset: [2, 3],
        }],
      },
    },
    placements: [
      {
        component: "complete_base",
        name: "west",
        worldOffset: [-4096, 0, 0],
        tileOffset: [10, 20],
      },
      {
        component: "complete_base",
        name: "east",
        worldOffset: [4096, 0, 0],
        tileOffset: [50, 20],
        mirrorAxis: "x",
        teamSwap: true,
      },
    ],
  });

  const entity = (targetname: string) =>
    specification.managedEntities?.find((candidate) => candidate.targetname === targetname);
  assert.equal(entity("west_core_controller")?.properties?.target, "west_core_route_1");
  assert.equal(entity("east_core_controller")?.properties?.target, "east_core_route_1");
  assert.equal(entity("west_core_camp")?.properties?.VolumeName, "west_core_camp_bounds");
  assert.equal(entity("east_core_camp")?.properties?.VolumeName, "east_core_camp_bounds");
  assert.equal(entity("west_core_base_ancient")?.origin, "-3840 0 128");
  assert.equal(entity("east_core_base_ancient")?.origin, "3840 0 128");
  assert.equal(entity("west_core_base_ancient")?.properties?.teamnumber, "2");
  assert.equal(entity("east_core_base_ancient")?.properties?.teamnumber, "3");
  assert.equal(entity("east_core_base_start")?.classname, "info_player_start_badguys");
  assert.equal(
    entity("east_core_base_mid_t2")?.properties?.MapUnitName,
    "npc_dota_badguys_tower2_mid",
  );
  assert.deepEqual(
    specification.managedPaths?.map(({ name, points }) => ({ name, points })),
    [
      { name: "west_core_route", points: [[-3840, 0, 128], [-3328, 0, 128]] },
      { name: "east_core_route", points: [[3840, 0, 128], [3328, 0, 128]] },
    ],
  );
  assert.deepEqual(specification.managedTerrain, [
    { op: "height", level: 1, dome: undefined, shape: { kind: "rect", x0: 12, y0: 23, x1: 13, y1: 24 } },
    { op: "height", level: 1, dome: undefined, shape: { kind: "rect", x0: 47, y0: 23, x1: 48, y1: 24 } },
  ]);
  const volume = (targetname: string) =>
    specification.managedVolumes?.find((candidate) => candidate.targetname === targetname);
  assert.equal(volume("west_core_bounds")?.properties?.OnUser1, "west_core_controller,Enable,,0,-1");
  assert.equal(volume("east_core_bounds")?.properties?.OnUser1, "east_core_controller,Enable,,0,-1");
});

test("nested team swaps compose instead of being inferred from geometry", () => {
  const specification = parseMapSpecification({
    components: {
      start: {
        dotaComponents: [{
          kind: "playerStart",
          name: "spawn",
          team: "radiant",
          origin: [0, 0, 128],
        }],
      },
      swapped_once: {
        placements: [{ component: "start", name: "inner", teamSwap: true }],
      },
    },
    placements: [
      { component: "swapped_once", name: "dire" },
      { component: "swapped_once", name: "radiant", teamSwap: true, mirrorAxis: "x" },
    ],
  });
  assert.equal(specification.managedEntities?.[0].classname, "info_player_start_badguys");
  assert.equal(specification.managedEntities?.[1].classname, "info_player_start_goodguys");
});

test("teamSwap turns one reusable Radiant base kit into a checked Dire placement", () => {
  const specification = parseMapSpecification({
    components: {
      base_kit: {
        managedAbsentEntities: [
          {
            targetname: "retired_start",
            classname: "info_player_start_goodguys",
            origin: "-1024 0 128",
            angles: "0 0 0",
          },
          {
            targetname: "neutral_absent",
            classname: "info_target",
            origin: "0 768 128",
          },
        ],
        managedEntities: [
          {
            targetname: "neutral_marker",
            classname: "info_target",
            origin: "0 1024 128",
            properties: { teamnumber: 4, VisualTeam: 4, direside: 0, comment: "neutral" },
          },
          {
            targetname: "team_visual_marker",
            classname: "info_target",
            origin: "0 1152 128",
            properties: { VisualTeam: 2, direside: 0 },
          },
        ],
        dotaComponents: [
          {
            kind: "base",
            name: "base",
            team: "radiant",
            origin: [0, 0, 128],
            ancientOffset: [0, 0, 0],
            fountain: { name: "fountain", offset: [-512, 0, 0] },
            shop: { name: "shop", offset: [-256, 256, 0], shopType: "home" },
            playerStarts: [{ name: "start", offset: [-768, 0, 0] }],
            towers: [{ name: "mid_t2", offset: [512, 0, 0], tier: 2, lane: "mid" }],
            gates: [{ name: "gate", offset: [0, 512, 0] }],
            blockers: [{ name: "blocker", offset: [0, 640, 0] }],
          },
        ],
      },
    },
    placements: [
      { component: "base_kit", name: "west", worldOffset: [-4096, 0, 0] },
      {
        component: "base_kit",
        name: "east",
        worldOffset: [4096, 0, 0],
        mirrorAxis: "x",
        teamSwap: true,
      },
    ],
  });

  const entity = (targetname: string) =>
    specification.managedEntities?.find((candidate) => candidate.targetname === targetname);
  assert.deepEqual(
    {
      classname: entity("west_base_ancient")?.classname,
      origin: entity("west_base_ancient")?.origin,
      teamnumber: entity("west_base_ancient")?.properties?.teamnumber,
      direside: entity("west_base_ancient")?.properties?.direside,
      unit: entity("west_base_ancient")?.properties?.MapUnitName,
      model: entity("west_base_ancient")?.properties?.model,
    },
    {
      classname: "npc_dota_fort",
      origin: "-4096 0 128",
      teamnumber: "2",
      direside: "0",
      unit: "npc_dota_goodguys_fort",
      model: "models/props_structures/radiant_ancient001.vmdl",
    },
  );
  assert.deepEqual(
    {
      classname: entity("east_base_ancient")?.classname,
      origin: entity("east_base_ancient")?.origin,
      teamnumber: entity("east_base_ancient")?.properties?.teamnumber,
      direside: entity("east_base_ancient")?.properties?.direside,
      unit: entity("east_base_ancient")?.properties?.MapUnitName,
      model: entity("east_base_ancient")?.properties?.model,
    },
    {
      classname: "npc_dota_fort",
      origin: "4096 0 128",
      teamnumber: "3",
      direside: "1",
      unit: "npc_dota_badguys_fort",
      model: "models/props_structures/dire_ancient_base001.vmdl",
    },
  );

  assert.equal(entity("east_base_fountain")?.properties?.teamnumber, "3");
  assert.equal(
    entity("east_base_fountain")?.properties?.model,
    "models/props_structures/bad_fountain001.vmdl",
  );
  assert.equal(entity("east_base_mid_t2")?.properties?.MapUnitName, "npc_dota_badguys_tower2_mid");
  assert.equal(
    entity("east_base_mid_t2")?.properties?.model,
    "models/props_structures/dire_tower002.vmdl",
  );
  assert.equal(entity("east_base_start")?.classname, "info_player_start_badguys");
  assert.equal(entity("east_base_shop")?.properties?.teamnumber, "3");
  assert.equal(entity("east_base_shop")?.properties?.direside, "1");
  assert.equal(entity("east_base_gate")?.properties?.teamnumber, "3");
  assert.equal(entity("east_base_gate")?.properties?.direside, "1");
  assert.equal(entity("east_base_blocker")?.properties?.teamnumber, "3");
  assert.equal(entity("east_base_blocker")?.properties?.direside, "1");
  assert.deepEqual(entity("east_neutral_marker")?.properties, {
    teamnumber: "4",
    VisualTeam: "4",
    direside: "0",
    comment: "neutral",
  });
  assert.deepEqual(entity("east_team_visual_marker")?.properties, {
    VisualTeam: "3",
    direside: "1",
  });
  const absent = (targetname: string) =>
    specification.managedAbsentEntities?.find((candidate) => candidate.targetname === targetname);
  assert.deepEqual(absent("west_retired_start"), {
    targetname: "west_retired_start",
    classname: "info_player_start_goodguys",
    origin: "-5120 0 128",
    angles: "0 0 0",
  });
  assert.deepEqual(absent("east_retired_start"), {
    targetname: "east_retired_start",
    classname: "info_player_start_badguys",
    origin: "5120 0 128",
    angles: "0 180 0",
  });
  assert.equal(absent("east_neutral_absent")?.classname, "info_target");
});

test("teamSwap reverses recognized Dire identity without rewriting custom values", () => {
  const specification = parseMapSpecification({
    components: {
      dire_piece: {
        managedEntities: [
          {
            targetname: "tower",
            classname: "npc_dota_tower",
            origin: "0 0 128",
            properties: {
              teamnumber: 3,
              direside: 1,
              MapUnitName: "npc_dota_badguys_tower2_mid",
              model: "models/props_structures/dire_tower002.vmdl",
              customTeamLabel: "dire_art_direction",
            },
          },
          {
            targetname: "start",
            classname: "info_player_start_badguys",
            origin: "256 0 128",
          },
        ],
      },
    },
    placements: [{ component: "dire_piece", name: "radiant_copy", teamSwap: true }],
  });

  const tower = specification.managedEntities?.find(
    (entity) => entity.targetname === "radiant_copy_tower",
  );
  assert.deepEqual(tower?.properties, {
    teamnumber: "2",
    direside: "0",
    MapUnitName: "npc_dota_goodguys_tower2_mid",
    model: "models/props_structures/radiant_tower002.vmdl",
    customTeamLabel: "dire_art_direction",
  });
  assert.equal(
    specification.managedEntities?.find((entity) => entity.targetname === "radiant_copy_start")
      ?.classname,
    "info_player_start_goodguys",
  );
});

test("component placements namespace and transform entities, paths, references, terrain, and volumes", () => {
  const specification = parseMapSpecification({
    regions: {
      platform: { shape: { kind: "circle", cx: 0, cy: 0, r: 3 } },
    },
    components: {
      guarded_platform: {
        managedEntities: [
          {
            targetname: "tower",
            classname: "npc_dota_tower",
            origin: "10 20 30",
            angles: "0 30 0",
            properties: { target: "@local:route_1", teamnumber: 2 },
          },
        ],
        managedPaths: [
          {
            name: "route",
            points: [[0, 0, 0], [100, 0, 0]],
          },
        ],
        managedTerrain: [
          {
            op: "height",
            level: 1,
            shape: { kind: "region", name: "platform" },
          },
          {
            op: "ramp",
            shape: { kind: "managedPath", name: "route", width: 2 },
          },
        ],
        managedVolumes: [
          {
            targetname: "bounds",
            recipe: "playerClip",
            center: [100, 200, 64],
            size: [600, 200, 256],
            yaw: 30,
            properties: { OnUser1: "@local:tower,Disable,,0,-1" },
          },
          {
            targetname: "asymmetric_bounds",
            recipe: "noWards",
            center: [0, 0, 64],
            polygon: {
              points: [[-200, -100], [200, -100], [100, 200], [-200, 100]],
              height: 256,
            },
          },
        ],
      },
    },
    placements: [
      {
        component: "guarded_platform",
        name: "west",
        worldOffset: [-1000, 0, 128],
        tileOffset: [8, 12],
      },
      {
        component: "guarded_platform",
        name: "east",
        worldOffset: [1000, 0, 128],
        tileOffset: [24, 12],
        mirrorAxis: "x",
      },
    ],
  });

  assert.deepEqual(
    specification.managedEntities?.map(({ targetname, origin, angles, properties }) => ({
      targetname,
      origin,
      angles,
      properties,
    })),
    [
      {
        targetname: "west_tower",
        origin: "-990 20 158",
        angles: "0 30 0",
        properties: { target: "west_route_1", teamnumber: "2" },
      },
      {
        targetname: "east_tower",
        origin: "990 20 158",
        angles: "0 150 0",
        properties: { target: "east_route_1", teamnumber: "2" },
      },
    ],
  );
  assert.deepEqual(specification.managedPaths?.map(({ name, points }) => ({ name, points })), [
    { name: "west_route", points: [[-1000, 0, 128], [-900, 0, 128]] },
    { name: "east_route", points: [[1000, 0, 128], [900, 0, 128]] },
  ]);
  assert.deepEqual(specification.managedTerrain, [
    { op: "height", level: 1, dome: undefined, shape: { kind: "circle", cx: 8, cy: 12, r: 3 } },
    { op: "ramp", shape: { kind: "managedPath", name: "west_route", width: 2 } },
    { op: "height", level: 1, dome: undefined, shape: { kind: "circle", cx: 24, cy: 12, r: 3 } },
    { op: "ramp", shape: { kind: "managedPath", name: "east_route", width: 2 } },
  ]);
  assert.deepEqual(specification.managedVolumes, [
    {
      targetname: "west_bounds",
      recipe: "playerClip",
      center: [-900, 200, 192],
      size: [600, 200, 256],
      yaw: 30,
      properties: { OnUser1: "west_tower,Disable,,0,-1" },
    },
    {
      targetname: "west_asymmetric_bounds",
      recipe: "noWards",
      center: [-1000, 0, 192],
      polygon: {
        points: [[-200, -100], [200, -100], [100, 200], [-200, 100]],
        height: 256,
      },
      yaw: 0,
      properties: undefined,
    },
    {
      targetname: "east_bounds",
      recipe: "playerClip",
      center: [900, 200, 192],
      size: [600, 200, 256],
      yaw: 150,
      properties: { OnUser1: "east_tower,Disable,,0,-1" },
    },
    {
      targetname: "east_asymmetric_bounds",
      recipe: "noWards",
      center: [1000, 0, 192],
      polygon: {
        points: [[-200, -100], [100, -200], [200, 100], [-200, 100]],
        height: 256,
      },
      yaw: 180,
      properties: undefined,
    },
  ]);
});

test("mirrored component volumes keep sloped corner heights paired with their footprint", () => {
  const specification = parseMapSpecification({
    components: {
      ramp_guard: {
        managedVolumes: [{
          targetname: "slope",
          recipe: "playerClip",
          center: [0, 0, 128],
          polygon: {
            points: [[-200, -100], [200, -100], [100, 200], [-200, 100]],
            bottom: [-64, 64, 32, -64],
            top: [64, 192, 160, 64],
          },
        }],
      },
    },
    placements: [{ component: "ramp_guard", name: "east", mirrorAxis: "x" }],
  });
  const polygon = specification.managedVolumes?.[0].polygon;
  assert.deepEqual(polygon, {
    points: [[-200, -100], [100, -200], [200, 100], [-200, 100]],
    bottom: [-64, 32, 64, -64],
    top: [64, 160, 192, 64],
  });
});

test("component definitions reject unsafe or unresolved reuse", () => {
  assert.throws(
    () =>
      parseMapSpecification({
        components: {
          whole_map: {
            managedTerrain: [{ op: "fill", level: 1 }],
          },
        },
      }),
    /cannot contain a fill terrain operation/,
  );
  assert.throws(
    () =>
      parseMapSpecification({
        placements: [{ component: "missing", name: "instance" }],
      }),
    /references missing component "missing"/,
  );
  assert.throws(
    () =>
      parseMapSpecification({
        components: {
          wrapper: { placements: [{ component: "missing", name: "inner" }] },
        },
      }),
    /component "wrapper" placement "inner" references missing component "missing"/i,
  );
  assert.throws(
    () =>
      parseMapSpecification({
        components: {
          leaf: {},
          wrapper: {
            placements: [
              { component: "leaf", name: "duplicate" },
              { component: "leaf", name: "duplicate" },
            ],
          },
        },
      }),
    /component "wrapper" placement name "duplicate" is duplicated/i,
  );
  assert.throws(
    () =>
      parseMapSpecification({
        components: {
          a: { placements: [{ component: "b", name: "b" }] },
          b: { placements: [{ component: "a", name: "a" }] },
        },
      }),
    /component placement cycle detected \(a -> b -> a\)/i,
  );
  assert.throws(
    () =>
      parseMapSpecification({
        regions: {
          a: { mirrorOf: "b", mirrorAxis: "x" },
          b: { mirrorOf: "a", mirrorAxis: "y" },
        },
      }),
    /mirror cycle/,
  );
});
