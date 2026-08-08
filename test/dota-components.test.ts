import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import {
  dotaComponentInputSchema,
  expandDotaComponents,
} from "../src/dota/dota-components.js";
import { parseMapSpecification } from "../src/dota/map-spec.js";

const componentList = z.array(dotaComponentInputSchema);

test("validated Dota point components expand to official map entity classes", () => {
  const components = componentList.parse([
    { kind: "ancient", name: "radiant_ancient", team: "radiant", origin: [-1000, 0, 256] },
    { kind: "tower", name: "dire_t2", team: "dire", origin: [500, 0, 128], tier: 2, lane: "mid" },
    { kind: "fountain", name: "radiant_fountain", team: "radiant", origin: [-1200, 0, 256] },
    { kind: "shop", name: "home_shop", team: "radiant", origin: [-1100, 300, 256], shopType: "home" },
    {
      kind: "camp",
      name: "bog_camp",
      origin: [0, -1000, 0],
      size: "medium",
      volumeName: "bog_camp_volume",
      forcedSubtype: 7,
      volume: { size: [768, 640, 384], yaw: 15 },
    },
    { kind: "playerStart", name: "radiant_start_1", team: "radiant", origin: [-1300, 0, 256] },
    { kind: "gate", name: "radiant_gate", team: "radiant", origin: [-1400, 800, 256] },
  ]);
  const expanded = expandDotaComponents(components);

  assert.deepEqual(expanded.managedEntities.map((entity) => entity.classname), [
    "npc_dota_fort",
    "npc_dota_tower",
    "ent_dota_fountain",
    "ent_dota_shop",
    "npc_dota_neutral_spawner",
    "info_player_start_goodguys",
    "npc_dota_unit_twin_gate",
  ]);
  assert.equal(expanded.managedEntities[0].properties?.MapUnitName, "npc_dota_goodguys_fort");
  assert.equal(expanded.managedEntities[1].properties?.MapUnitName, "npc_dota_badguys_tower2_mid");
  assert.equal(expanded.managedEntities[4].properties?.NeutralType, "1");
  assert.equal(expanded.managedEntities[4].properties?.ForcedSubType, "7");
  assert.equal(expanded.managedEntities[4].properties?.VolumeName, "bog_camp_volume");
  assert.deepEqual(expanded.managedVolumes, [{
    targetname: "bog_camp_volume",
    recipe: "camp",
    center: [0, -1000, 0],
    size: [768, 640, 384],
    yaw: 15,
  }]);
});

test("base components rotate explicit local members into a reusable assembly", () => {
  const [base] = componentList.parse([
    {
      kind: "base",
      name: "dire_base",
      team: "dire",
      origin: [1000, 2000, 256],
      yaw: 90,
      fountain: { name: "fountain", offset: [-200, 0, 0] },
      shop: { name: "shop", offset: [0, 300, 0], shopType: "home" },
      playerStarts: [{ name: "start_1", offset: [-100, 100, 0] }],
      towers: [{ name: "t3", offset: [400, 0, 0], tier: 3, lane: "mid" }],
      gates: [{ name: "north_gate", offset: [0, 600, 0] }],
      blockers: [{ name: "south_blocker", offset: [0, -600, 0], yaw: 90 }],
    },
  ]);
  const entities = expandDotaComponents([base]).managedEntities;

  assert.deepEqual(entities.map((entity) => entity.targetname), [
    "dire_base_ancient",
    "dire_base_fountain",
    "dire_base_shop",
    "dire_base_start_1",
    "dire_base_t3",
    "dire_base_north_gate",
    "dire_base_south_blocker",
  ]);
  assert.equal(entities[1].origin, "1000 1800 256");
  assert.equal(entities[2].origin, "700 2000 256");
  assert.equal(entities[4].origin, "1000 2400 256");
  assert.equal(entities[4].angles, "0 90 0");
  assert.equal(entities[6].classname, "npc_dota_base_blocker");
  assert.equal(entities[6].origin, "1600 2000 256");
  assert.equal(entities[6].angles, "0 180 0");
  assert.equal(entities[6].properties?.teamnumber, "3");
});

test("checked point blockers expand to team gates and deterministic FoW chains", () => {
  const components = componentList.parse([
    {
      kind: "baseBlocker",
      name: "radiant_north_blocker",
      team: "radiant",
      origin: [-5000, 1200, 256],
      yaw: 90,
    },
    {
      kind: "fowBlocker",
      name: "dragon_pit_fow",
      points: [[-512, 2048, 512], [0, 2304, 512], [512, 2048, 512]],
      closed: true,
    },
  ]);
  const expanded = expandDotaComponents(components);

  assert.equal(expanded.managedEntities[0].classname, "npc_dota_base_blocker");
  assert.equal(expanded.managedEntities[0].properties?.teamnumber, "2");
  assert.deepEqual(
    expanded.managedEntities.slice(1).map((entity) => ({
      targetname: entity.targetname,
      classname: entity.classname,
      target: entity.properties?.TargetNode,
    })),
    [
      { targetname: "dragon_pit_fow_1", classname: "ent_fow_blocker_node", target: "dragon_pit_fow_2" },
      { targetname: "dragon_pit_fow_2", classname: "ent_fow_blocker_node", target: "dragon_pit_fow_3" },
      { targetname: "dragon_pit_fow_3", classname: "ent_fow_blocker_node", target: "dragon_pit_fow_1" },
    ],
  );
});

test("segmented walls expand a practical curved outline into overlapping convex blockers", () => {
  const [wall] = componentList.parse([
    {
      kind: "wall",
      name: "radiant_base_wall",
      points: [[-5120, -3072, 0], [-4352, -2304, 0], [-4096, -1024, 0]],
      thickness: 192,
      height: 768,
      overlap: 48,
    },
  ]);
  const volumes = expandDotaComponents([wall]).managedVolumes;

  assert.equal(volumes.length, 2);
  assert.equal(volumes[0].targetname, "radiant_base_wall_1");
  assert.equal(volumes[0].recipe, "playerClip");
  assert.deepEqual(volumes[0].center, [-4736, -2688, 384]);
  assert.deepEqual(volumes[0].size, [Math.hypot(768, 768) + 48, 192, 768]);
  assert.equal(volumes[0].yaw, 45);
  assert.deepEqual(volumes[1].center, [-4224, -1664, 384]);
});

test("closed segmented walls add a final blocker and reject degenerate or sloped segments", () => {
  const [wall] = componentList.parse([
    {
      kind: "wall",
      name: "pit_wall",
      points: [[-256, -256, 0], [256, -256, 0], [0, 256, 0]],
      thickness: 128,
      height: 512,
      closed: true,
    },
  ]);
  assert.equal(expandDotaComponents([wall]).managedVolumes.length, 3);

  assert.throws(
    () => componentList.parse([{
      kind: "wall",
      name: "bad_wall",
      points: [[0, 0, 0], [0, 0, 0]],
      thickness: 128,
      height: 512,
    }]),
    /must not repeat/,
  );
  assert.throws(
    () => componentList.parse([{
      kind: "wall",
      name: "sloped_wall",
      points: [[0, 0, 0], [512, 0, 128]],
      thickness: 128,
      height: 512,
    }]),
    /sloped wall segments are not yet supported/,
  );
});

test("checked arches expand into two posts and one elevated lintel", () => {
  const [arch] = componentList.parse([{
    kind: "arch",
    name: "radiant_gate_arch",
    origin: [100, 200, 128],
    yaw: 90,
    width: 1024,
    depth: 256,
    height: 768,
    openingWidth: 512,
    openingHeight: 512,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  const solids = expandDotaComponents([arch]).managedSolids;

  assert.deepEqual(solids.map((solid) => solid.targetname), [
    "radiant_gate_arch_left_post",
    "radiant_gate_arch_right_post",
    "radiant_gate_arch_lintel",
  ]);
  assert.deepEqual(solids.map((solid) => solid.center), [
    [100, -184, 384],
    [100, 584, 384],
    [100, 200, 768],
  ]);
  assert.deepEqual(solids.map((solid) => solid.extrusion), [
    { points: [[-128, -128], [128, -128], [128, 128], [-128, 128]], height: 512 },
    { points: [[-128, -128], [128, -128], [128, 128], [-128, 128]], height: 512 },
    { points: [[-512, -128], [512, -128], [512, 128], [-512, 128]], height: 256 },
  ]);
  assert.ok(solids.every((solid) => solid.yaw === 90));

  assert.throws(
    () => componentList.parse([{ ...arch, openingWidth: 1024 }]),
    /openingWidth must be smaller/,
  );
  assert.throws(
    () => componentList.parse([{ ...arch, openingHeight: 768 }]),
    /openingHeight must be smaller/,
  );
  assert.throws(
    () => componentList.parse([{ ...arch, openingWidth: 1023.5 }]),
    /at least one world unit for each post/,
  );
  assert.throws(
    () => componentList.parse([{ ...arch, openingHeight: 767.5 }]),
    /at least one world unit for the lintel/,
  );
});

test("checked profile arches compose an irregular opening from sloped overhead segments", () => {
  const profile: [number, number][] = [
    [-384, 384], [-192, 600], [0, 704], [192, 600], [384, 384],
  ];
  const [arch] = componentList.parse([{
    kind: "profileArch",
    name: "dragon_profile_arch",
    origin: [100, 200, 128],
    yaw: 0,
    width: 1024,
    depth: 256,
    height: 768,
    profile,
    material: "materials/dev/reflectivity_30.vmat",
    faceMaterials: {
      top: "materials/dev/reflectivity_50.vmat",
      bottom: "materials/dev/reflectivity_20.vmat",
    },
    faceTextureScales: {
      top: [0.25, 0.25],
      sides: [0.5, 1],
    },
    faceTextureShifts: {
      top: [0, 64],
      sides: [16, -16],
    },
    faceTextureRotations: { top: 45, sides: -90 },
  }]);
  const solids = expandDotaComponents([arch]).managedSolids;

  assert.equal(solids.length, 6);
  assert.deepEqual(solids.map((solid) => solid.targetname), [
    "dragon_profile_arch_left_post",
    "dragon_profile_arch_right_post",
    "dragon_profile_arch_arch_segment_01",
    "dragon_profile_arch_arch_segment_02",
    "dragon_profile_arch_arch_segment_03",
    "dragon_profile_arch_arch_segment_04",
  ]);
  assert.deepEqual(solids[0], {
    targetname: "dragon_profile_arch_left_post",
    center: [-348, 200, 512],
    yaw: 0,
    material: "materials/dev/reflectivity_30.vmat",
    faceMaterials: {
      top: "materials/dev/reflectivity_50.vmat",
      bottom: "materials/dev/reflectivity_20.vmat",
    },
    faceTextureScales: {
      top: [0.25, 0.25],
      sides: [0.5, 1],
    },
    faceTextureShifts: {
      top: [0, 64],
      sides: [16, -16],
    },
    faceTextureRotations: { top: 45, sides: -90 },
    extrusion: {
      points: [[-64, -128], [64, -128], [64, 128], [-64, 128]],
      height: 768,
    },
  });
  assert.deepEqual(solids[2], {
    targetname: "dragon_profile_arch_arch_segment_01",
    center: [-188, 200, 512],
    yaw: 0,
    material: "materials/dev/reflectivity_30.vmat",
    faceMaterials: {
      top: "materials/dev/reflectivity_50.vmat",
      bottom: "materials/dev/reflectivity_20.vmat",
    },
    faceTextureScales: {
      top: [0.25, 0.25],
      sides: [0.5, 1],
    },
    faceTextureShifts: {
      top: [0, 64],
      sides: [16, -16],
    },
    faceTextureRotations: { top: 45, sides: -90 },
    extrusion: {
      points: [[-96, -128], [96, -128], [96, 128], [-96, 128]],
      bottom: [0, 216, 216, 0],
      top: [384, 384, 384, 384],
    },
  });
  assert.throws(
    () => componentList.parse([{ ...arch, profile: [[-512, 384], [384, 384]] }]),
    /leave at least one world unit for both outer posts/,
  );
  assert.throws(
    () => componentList.parse([{ ...arch, profile: [[-384, 384], [-384, 600]] }]),
    /to the right of the preceding profile point/,
  );
  assert.throws(
    () => componentList.parse([{ ...arch, profile: [[-384, 768], [384, 384]] }]),
    /below the outer height/,
  );
});

test("checked bridges pair a visible solid deck with Valve navigation-walkable geometry", () => {
  const [bridge] = componentList.parse([{
    kind: "bridge",
    name: "river_crossing",
    center: [100, 200, 352],
    yaw: 30,
    length: 1536,
    width: 512,
    thickness: 64,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  const expanded = expandDotaComponents([bridge]);

  assert.deepEqual(expanded.managedSolids, [{
    targetname: "river_crossing_deck",
    center: [100, 200, 352],
    yaw: 30,
    material: "materials/dev/reflectivity_30.vmat",
    extrusion: {
      points: [[-768, -256], [768, -256], [768, 256], [-768, 256]],
      height: 64,
    },
  }]);
  assert.deepEqual(expanded.managedNavSurfaces, [{
    targetname: "river_crossing_walkable",
    center: [100, 200, 352],
    yaw: 30,
    extrusion: {
      points: [[-768, -256], [768, -256], [768, 256], [-768, 256]],
      height: 64,
    },
  }]);
  assert.throws(() => componentList.parse([{ ...bridge, width: 0 }]), /greater than or equal to 2/);
  assert.throws(() => componentList.parse([{ ...bridge, thickness: 0 }]), /greater than or equal to 1/);
  assert.throws(() => componentList.parse([{ ...bridge, material: "not-a-material" }]), /Invalid/);
});

test("checked bridge approaches derive a sloped solid and exact walkable twin from world endpoints", () => {
  const [approach] = componentList.parse([{
    kind: "bridgeApproach",
    name: "west_bridge_approach",
    start: [-1536, 0, 128],
    end: [-512, 0, 384],
    width: 512,
    thickness: 64,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  const expanded = expandDotaComponents([approach]);
  const expectedExtrusion = {
    points: [[-512, -256], [512, -256], [512, 256], [-512, 256]],
    bottom: [-192, 64, 64, -192],
    top: [-128, 128, 128, -128],
  };
  assert.deepEqual(expanded.managedSolids, [{
    targetname: "west_bridge_approach_ramp",
    center: [-1024, 0, 256],
    yaw: 0,
    material: "materials/dev/reflectivity_30.vmat",
    extrusion: expectedExtrusion,
  }]);
  assert.deepEqual(expanded.managedNavSurfaces, [{
    targetname: "west_bridge_approach_walkable",
    center: [-1024, 0, 256],
    yaw: 0,
    extrusion: expectedExtrusion,
  }]);
  assert.throws(
    () => componentList.parse([{ ...approach, end: [-1536, 0, 384] }]),
    /at least two horizontal world units apart/,
  );
});

test("checked ring platforms compose a real central opening from deck/navigation wedges", () => {
  const [platform] = componentList.parse([{
    kind: "ringPlatform",
    name: "dragon_ring",
    center: [0, 4096, 384],
    yaw: 45,
    outerRadius: 512,
    innerRadius: 256,
    height: 64,
    sides: 4,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  const expanded = expandDotaComponents([platform]);
  assert.equal(expanded.managedSolids.length, 4);
  assert.equal(expanded.managedNavSurfaces.length, 4);
  assert.deepEqual(expanded.managedSolids.map((solid) => solid.targetname), [
    "dragon_ring_segment_01_deck",
    "dragon_ring_segment_02_deck",
    "dragon_ring_segment_03_deck",
    "dragon_ring_segment_04_deck",
  ]);
  assert.deepEqual(expanded.managedSolids[0], {
    targetname: "dragon_ring_segment_01_deck",
    center: [0, 4096, 384],
    yaw: 45,
    material: "materials/dev/reflectivity_30.vmat",
    extrusion: {
      points: [[512, 0], [0, 512], [0, 256], [256, 0]],
      height: 64,
    },
  });
  assert.deepEqual(
    expanded.managedNavSurfaces[0]?.extrusion,
    expanded.managedSolids[0]?.extrusion,
  );
  assert.throws(
    () => componentList.parse([{ ...platform, innerRadius: 511 }]),
    /at least two world units of platform/,
  );
});

test("checked holed platforms compose paired irregular outlines without raw mesh input", () => {
  const outer: [number, number][] = [
    [-600, -400], [400, -500], [700, 0], [350, 550], [-550, 450],
  ];
  const hole: [number, number][] = [
    [-250, -150], [180, -220], [300, 20], [140, 240], [-220, 180],
  ];
  const [platform] = componentList.parse([{
    kind: "holedPlatform",
    name: "irregular_overlook",
    center: [2048, 1024, 384],
    yaw: 12,
    outer,
    hole,
    height: 64,
    material: "materials/dev/reflectivity_30.vmat",
  }]);
  const expanded = expandDotaComponents([platform]);

  assert.equal(expanded.managedSolids.length, 5);
  assert.equal(expanded.managedNavSurfaces.length, 5);
  assert.deepEqual(expanded.managedSolids[0], {
    targetname: "irregular_overlook_segment_01_deck",
    center: [2048, 1024, 384],
    yaw: 12,
    material: "materials/dev/reflectivity_30.vmat",
    extrusion: {
      points: [outer[0], outer[1], hole[1], hole[0]],
      height: 64,
    },
  });
  assert.deepEqual(
    expanded.managedNavSurfaces.map((surface) => surface.extrusion),
    expanded.managedSolids.map((solid) => solid.extrusion),
  );
  const [unequalPlatform] = componentList.parse([{ ...platform, hole: hole.slice(0, 4) }]);
  const unequalSolids = expandDotaComponents([unequalPlatform]).managedSolids;
  assert.equal(unequalSolids.length, 8);
  const unequalOuterBoundary = unequalSolids.map((solid) => solid.extrusion.points[0]);
  const unequalHoleBoundary = unequalSolids.map((solid) => solid.extrusion.points[3]);
  assert.ok(outer.every((point) => unequalOuterBoundary.some((candidate) =>
    candidate[0] === point[0] && candidate[1] === point[1])));
  assert.ok(hole.slice(0, 4).every((point) => unequalHoleBoundary.some((candidate) =>
    candidate[0] === point[0] && candidate[1] === point[1])));
  const clockwiseOuter = [outer[0], ...outer.slice(1).reverse()];
  const clockwiseHole = [hole[0], ...hole.slice(1).reverse()];
  const [clockwisePlatform] = componentList.parse([{
    ...platform,
    outer: clockwiseOuter,
    hole: clockwiseHole,
  }]);
  assert.deepEqual(
    expandDotaComponents([clockwisePlatform]).managedSolids.map((solid) => solid.extrusion),
    expanded.managedSolids.map((solid) => solid.extrusion),
  );
  assert.throws(
    () => componentList.parse([{
      ...platform,
      hole: hole.map(([x, y]) => [x + 1000, y] as [number, number]),
    }]),
    /strictly inside the outer outline/,
  );
  assert.throws(
    () => componentList.parse([{ ...platform, hole: [...hole].reverse() }]),
    /same clockwise or counter-clockwise point order/,
  );
  assert.throws(
    () => componentList.parse([{
      ...platform,
      hole: hole.map((_point, index) => hole[(index + 2) % hole.length]),
    }]),
    /spoke crosses|must form a platform segment/,
  );
});

test("checked multi-hole platforms emit only independently proven triangle pairs", () => {
  const outer: [number, number][] = [
    [-900, -700], [900, -700], [900, 700], [-900, 700],
  ];
  const holes: [number, number][][] = [
    [[-700, -220], [-360, -180], [-380, 170], [-720, 140]],
    [[300, -120], [680, -210], [720, 220], [330, 180]],
  ];
  const [platform] = componentList.parse([{
    kind: "multiHoledPlatform",
    name: "twin_wells",
    center: [0, -4096, 384],
    yaw: -8,
    outer,
    holes,
    height: 64,
    material: "materials/dev/reflectivity_30.vmat",
    faceMaterials: { top: "materials/dev/reflectivity_50.vmat" },
    faceTextureScales: { top: [0.25, 0.25], sides: [0.5, 1] },
    faceTextureShifts: { top: [0, 64], sides: [16, -16] },
    faceTextureRotations: { top: 45, sides: -90 },
  }]);
  const expanded = expandDotaComponents([platform]);

  assert.equal(expanded.managedSolids.length, 14);
  assert.equal(expanded.managedNavSurfaces.length, 14);
  assert.deepEqual(expanded.managedSolids.map((solid) => solid.targetname),
    Array.from({ length: 14 }, (_unused, index) =>
      `twin_wells_triangle_${String(index + 1).padStart(3, "0")}_deck`));
  assert.ok(expanded.managedSolids.every((solid) =>
    solid.extrusion.points.length === 3 &&
    solid.faceMaterials?.top === "materials/dev/reflectivity_50.vmat" &&
    solid.faceTextureScales?.top?.[0] === 0.25 &&
    solid.faceTextureScales?.sides?.[0] === 0.5 &&
    solid.faceTextureShifts?.top?.[1] === 64 &&
    solid.faceTextureShifts?.sides?.[0] === 16 &&
    solid.faceTextureRotations?.top === 45 &&
    solid.faceTextureRotations?.sides === -90));
  assert.deepEqual(
    expanded.managedNavSurfaces.map((surface) => surface.extrusion),
    expanded.managedSolids.map((solid) => solid.extrusion),
  );
  assert.throws(
    () => componentList.parse([{ ...platform, holes: [holes[0]] }]),
    /at least 2 element/,
  );
  assert.throws(
    () => componentList.parse([{ ...platform, holes: [holes[0], holes[0]] }]),
    /must not touch or overlap/,
  );
});

test("boss pit components create structured terrain, entrances, and an official spawn", () => {
  const [pit] = componentList.parse([
    {
      kind: "bossPit",
      name: "south_rosh",
      boss: "roshan",
      worldCenter: [0, -5120, 0],
      tileCenter: [32, 12],
      radius: 3.5,
      rimWidth: 1.5,
      floorLevel: -1,
      rimLevel: 0,
      tileset: 1,
      entrances: ["north", "east", "west"],
      noWardsRadius: 875,
    },
  ]);
  const expanded = expandDotaComponents([pit]);

  assert.equal(expanded.managedEntities[0].classname, "npc_dota_roshan_spawner");
  assert.equal(expanded.managedEntities.length, 1);
  assert.equal(expanded.managedVolumes[0].targetname, "south_rosh_no_wards");
  assert.equal(expanded.managedVolumes[0].recipe, "noWards");
  assert.equal(expanded.managedVolumes[0].polygon?.points.length, 32);
  assert.equal(expanded.managedVolumes[0].polygon?.height, 1024);
  assert.deepEqual(expanded.managedTerrain.map((operation) => operation.op), [
    "height",
    "height",
    "water",
    "tileset",
    "ramp",
    "ramp",
    "ramp",
  ]);
});

test("Dota components reject incomplete towers and unsafe pit geometry", () => {
  assert.throws(
    () => componentList.parse([
      { kind: "tower", name: "bad_t2", team: "radiant", origin: [0, 0, 0], tier: 2 },
    ]),
    /lane is required/,
  );
  assert.throws(
    () => componentList.parse([
      {
        kind: "bossPit",
        name: "flat_pit",
        boss: "custom",
        worldCenter: [0, 0, 0],
        tileCenter: [10, 10],
        radius: 3,
        floorLevel: 1,
        rimLevel: 1,
      },
    ]),
    /floorLevel must be lower/,
  );
});

test("the unified map specification exercises built-in Dota components", () => {
  const specification = parseMapSpecification({
    dotaComponents: [
      { kind: "ancient", name: "dota_goodguys_fort", team: "radiant", origin: [-1024, 0, 128] },
      { kind: "playerStart", name: "radiant_start", team: "radiant", origin: [-1200, 0, 128] },
    ],
  });

  assert.equal(specification.managedEntities?.length, 2);
  assert.equal(specification.managedEntities?.[0].classname, "npc_dota_fort");
  assert.equal(specification.managedEntities?.[1].classname, "info_player_start_goodguys");
});

test("the documented Dota component assembly remains valid", async () => {
  const url = new URL("../examples/dota-components.json", import.meta.url);
  const specification = parseMapSpecification(JSON.parse(await readFile(url, "utf8")), url.pathname);

  assert.equal(specification.map, "component_arena");
  assert.equal(specification.managedEntities?.filter((entity) => entity.classname === "npc_dota_fort").length, 2);
  assert.equal(specification.managedEntities?.filter((entity) => entity.classname === "npc_dota_tower").length, 5);
  assert.equal(specification.managedTerrain?.filter((operation) => operation.op === "ramp").length, 3);
  assert.equal(specification.managedSolids?.length, 42);
  assert.equal(specification.managedNavSurfaces?.length, 33);
});
