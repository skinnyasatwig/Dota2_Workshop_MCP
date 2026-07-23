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
      managedPaths: [
        {
          name: "path_radiant_north",
          startIndex: 1,
          points: [
            [-1024, 512, 128],
            [0, 0, 128],
            [1024, 512, 128],
          ],
        },
      ],
    }),
  );
  const resolved = await loadMapContract(root, "twin_gates");
  assert.equal(resolved?.path, path);
  assert.equal(resolved?.contract.requiredEntities.length, 2);
  assert.equal(resolved?.contract.requiredEntities[0].properties?.teamnumber, "2");
  assert.equal(resolved?.contract.managedEntities?.[0].origin, "-1024 512 128");
  assert.equal(resolved?.contract.managedEntities?.[0].properties?.enabled, "true");
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
