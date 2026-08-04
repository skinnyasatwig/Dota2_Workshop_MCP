// Small repository-owned VMAP overlay used to prove the converter/compiler pipeline without
// copying Valve's addon_template map or depending on a user's private project. A valid installed
// blank map remains the structural seed because resourcecompiler crashes on incomplete bare roots.

import {
  buildEntityBlock,
  EntitySpec,
  insertEntity,
  maxNodeId,
  parseMapEntities,
} from "./vmap.js";
import { parseMapVolumes, reconcileMapVolumes } from "./map-volume.js";

/** Apply the repository-owned fixture payload to a valid blank VMAP structural seed. */
export function buildRepositoryCompileFixtureText(baseText: string): string {
  let text = baseText;
  let nodeId = maxNodeId(text) + 1;
  const entities: EntitySpec[] = [
    {
      classname: "info_player_start_goodguys",
      origin: "-256 0 128",
      properties: { targetname: "fixture_radiant_start" },
    },
    {
      classname: "info_player_start_badguys",
      origin: "256 0 128",
      angles: "0 180 0",
      properties: { targetname: "fixture_dire_start" },
    },
    {
      classname: "path_corner",
      origin: "-256 0 128",
      properties: { targetname: "fixture_route_1", target: "fixture_route_2" },
    },
    {
      classname: "path_corner",
      origin: "256 0 128",
      properties: { targetname: "fixture_route_2" },
    },
    {
      classname: "npc_dota_base_blocker",
      origin: "0 384 128",
      properties: { targetname: "fixture_base_blocker", teamnumber: "2" },
    },
  ];
  for (const entity of entities) text = insertEntity(text, buildEntityBlock(entity, nodeId++));

  return reconcileMapVolumes(text, [{
    targetname: "fixture_polygon_no_wards",
    recipe: "noWards",
    center: [0, 0, 256],
    polygon: {
      points: Array.from({ length: 12 }, (_unused, index) => {
        const angle = (index / 12) * Math.PI * 2;
        return [Math.cos(angle) * 384, Math.sin(angle) * 384] as [number, number];
      }),
      height: 512,
    },
  }]).text;
}

export function inspectRepositoryCompileFixture(text: string): {
  entities: ReturnType<typeof parseMapEntities>;
  volumes: ReturnType<typeof parseMapVolumes>;
} {
  return { entities: parseMapEntities(text), volumes: parseMapVolumes(text) };
}
