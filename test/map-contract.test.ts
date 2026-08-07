import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMapContract, managedEntitiesForContract } from "../src/dota/map-contract.js";

async function freshRoot(): Promise<string> {
  const root = join(tmpdir(), "mcp-map-contract");
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, ".dota-workshop"), { recursive: true });
  return root;
}

test("loadMapContract loads and validates the project default", async () => {
  const root = await freshRoot();
  const path = join(root, ".dota-workshop", "map-contract.json");
  await writeFile(
    path,
    JSON.stringify({
      map: "twin_gates",
      requiredEntities: [
        { targetname: "radiant_t1", classname: "npc_dota_tower", properties: { teamnumber: 2 } },
        { targetname: "path_radiant_north_1", classname: "path_corner" },
      ],
      managedEntities: [
        {
          targetname: "radiant_spawn_north",
          classname: "info_target",
          origin: "-1024 512 128",
          angles: "0 90 0",
          properties: { enabled: true },
        },
      ],
      managedAbsentEntities: [
        {
          classname: "info_player_start_goodguys",
          origin: "-128 -64 128",
        },
      ],
      managedPaths: [
        {
          name: "path_radiant_north",
          startIndex: 1,
          maxSegmentLength: 1200,
          points: [
            [-1024, 512, 128],
            [0, 0, 128],
            [1024, 512, 128],
          ],
        },
      ],
      managedTerrain: [
        { op: "fill", water: false },
        {
          op: "tileset",
          tileset: 1,
          shape: { kind: "path", points: [[4, 32], [60, 32]], width: 4 },
        },
        {
          op: "tileset",
          tileset: 1,
          shape: { kind: "managedPath", name: "path_radiant_north", width: 2 },
        },
      ],
      managedVolumes: [
        {
          targetname: "north_camp_bounds",
          recipe: "camp",
          center: [512, 1024, 192],
          size: [768, 640, 384],
        },
      ],
      managedSolids: [{
        targetname: "north_wall",
        center: [0, 1024, 128],
        material: "materials/dev/reflectivity_30.vmat",
        extrusion: {
          points: [[-384, -128], [384, -128], [384, 0], [0, 0], [0, 256], [-384, 256]],
          height: 256,
        },
      }],
    }),
  );
  const resolved = await loadMapContract(root, "twin_gates");
  assert.equal(resolved?.path, path);
  assert.equal(resolved?.contract.requiredEntities.length, 2);
  assert.equal(resolved?.contract.requiredEntities[0].properties?.teamnumber, "2");
  assert.equal(resolved?.contract.managedEntities?.[0].origin, "-1024 512 128");
  assert.equal(resolved?.contract.managedEntities?.[0].properties?.enabled, "true");
  assert.equal(resolved?.contract.managedAbsentEntities?.length, 1);
  assert.equal(resolved?.contract.managedTerrain?.length, 3);
  assert.equal(resolved?.contract.managedTerrain?.[1].op, "tileset");
  assert.equal(resolved?.contract.managedSolids?.[0].targetname, "north_wall");
  assert.equal(resolved?.contract.managedVolumes?.[0].targetname, "north_camp_bounds");
  const managed = managedEntitiesForContract(resolved!.contract);
  assert.equal(managed.length, 4);
  assert.deepEqual(
    managed.slice(1).map((entity) => ({
      targetname: entity.targetname,
      origin: entity.origin,
      target: entity.properties?.target,
      removeProperties: entity.removeProperties,
    })),
    [
      {
        targetname: "path_radiant_north_1",
        origin: "-1024 512 128",
        target: "path_radiant_north_2",
        removeProperties: undefined,
      },
      {
        targetname: "path_radiant_north_2",
        origin: "0 0 128",
        target: "path_radiant_north_3",
        removeProperties: undefined,
      },
      {
        targetname: "path_radiant_north_3",
        origin: "1024 512 128",
        target: undefined,
        removeProperties: ["target"],
      },
    ],
  );
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects a contract for another map", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({ map: "another_map", requiredEntities: [] }),
  );
  await assert.rejects(() => loadMapContract(root, "twin_gates"), /another_map.*twin_gates/);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract treats an absent default as optional", async () => {
  const root = join(tmpdir(), "mcp-map-contract-absent");
  await rm(root, { recursive: true, force: true });
  await mkdir(root);
  assert.equal(await loadMapContract(root, "twin_gates"), undefined);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects duplicate managed targetnames", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedEntities: [
        { targetname: "spawn", classname: "info_target", origin: "0 0 0" },
        { targetname: "spawn", classname: "info_target", origin: "1 0 0" },
      ],
    }),
  );
  await assert.rejects(() => loadMapContract(root, "twin_gates"), /duplicate targetname "spawn"/);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects volume names that collide with managed entities", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedEntities: [
        { targetname: "bounds", classname: "info_target", origin: "0 0 0" },
      ],
      managedVolumes: [
        {
          targetname: "bounds",
          recipe: "trigger",
          center: [0, 0, 128],
          size: [256, 256, 256],
        },
      ],
    }),
  );
  await assert.rejects(() => loadMapContract(root, "twin_gates"), /duplicate targetname "bounds"/);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects solid names that collide with managed entities", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedEntities: [{ targetname: "wall", classname: "info_target", origin: "0 0 0" }],
      managedSolids: [{
        targetname: "wall",
        center: [0, 0, 128],
        material: "materials/dev/reflectivity_30.vmat",
        extrusion: { points: [[-128, -128], [128, -128], [128, 128], [-128, 128]], height: 256 },
      }],
    }),
  );
  await assert.rejects(() => loadMapContract(root, "twin_gates"), /duplicate targetname "wall"/);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects path names that collide with managed entities", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedEntities: [
        { targetname: "route_1", classname: "info_target", origin: "0 0 0" },
      ],
      managedPaths: [
        {
          name: "route",
          startIndex: 1,
          points: [[0, 0, 0]],
        },
      ],
    }),
  );
  await assert.rejects(() => loadMapContract(root, "twin_gates"), /duplicate targetname "route_1"/);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects broken managed path mirror assertions", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedPaths: [
        {
          name: "north_route",
          points: [[-100, -50, 0], [100, -50, 0]],
        },
        {
          name: "south_route",
          mirrorOf: "north_route",
          mirrorAxis: "y",
          points: [[-100, 50, 0], [100, 40, 0]],
        },
      ],
    }),
  );
  await assert.rejects(() => loadMapContract(root, "twin_gates"), /not the y-axis mirror/);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects managed path segments over the declared maximum", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedPaths: [
        {
          name: "route",
          maxSegmentLength: 100,
          points: [[0, 0, 0], [101, 0, 0]],
        },
      ],
    }),
  );
  await assert.rejects(() => loadMapContract(root, "twin_gates"), /exceeds maxSegmentLength 100/);
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects terrain references to missing managed paths", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedTerrain: [
        {
          op: "tileset",
          tileset: 1,
          shape: { kind: "managedPath", name: "missing_lane", width: 2 },
        },
      ],
    }),
  );
  await assert.rejects(
    () => loadMapContract(root, "twin_gates"),
    /references missing managedPath "missing_lane"/,
  );
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract requires exact absence selectors", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedAbsentEntities: [{ classname: "info_target" }],
    }),
  );
  await assert.rejects(
    () => loadMapContract(root, "twin_gates"),
    /must set targetname or origin/,
  );
  await rm(root, { recursive: true, force: true });
});

test("loadMapContract rejects desired and absent targetname conflicts", async () => {
  const root = await freshRoot();
  await writeFile(
    join(root, ".dota-workshop", "map-contract.json"),
    JSON.stringify({
      requiredEntities: [],
      managedEntities: [
        { targetname: "spawn", classname: "info_target", origin: "0 0 0" },
      ],
      managedAbsentEntities: [
        { targetname: "spawn", classname: "info_target" },
      ],
    }),
  );
  await assert.rejects(
    () => loadMapContract(root, "twin_gates"),
    /both requires and removes targetname "spawn"/,
  );
  await rm(root, { recursive: true, force: true });
});
