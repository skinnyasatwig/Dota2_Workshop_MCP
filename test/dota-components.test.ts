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
});
