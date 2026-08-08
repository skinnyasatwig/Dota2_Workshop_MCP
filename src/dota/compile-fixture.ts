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
import { parseMapSolids, reconcileMapSolids } from "./map-solid.js";
import { parseMapNavSurfaces, reconcileMapNavSurfaces } from "./map-nav-surface.js";
import { expandDotaComponents } from "./dota-components.js";

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
    {
      classname: "point_simple_obstruction",
      origin: "0 384 128",
      properties: { targetname: "fixture_nav_obstruction" },
    },
  ];
  for (const entity of entities) text = insertEntity(text, buildEntityBlock(entity, nodeId++));

  text = reconcileMapVolumes(text, [
    {
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
    },
    {
      targetname: "fixture_sloped_trigger",
      recipe: "trigger",
      center: [2048, 2048, 256],
      polygon: {
        points: [[-256, -128], [256, -128], [256, 128], [-256, 128]],
        bottom: [-128, -128, 0, 0],
        top: [128, 128, 256, 256],
      },
    },
  ]).text;
  const structures = expandDotaComponents([
    {
      kind: "arch",
      name: "fixture_arch",
      origin: [-2048, 1024, 128],
      yaw: 15,
      width: 1024,
      depth: 256,
      height: 768,
      openingWidth: 512,
      openingHeight: 512,
      material: "materials/dev/reflectivity_30.vmat",
    },
    {
      kind: "bridge",
      name: "fixture_bridge",
      center: [-2048, -1024, 384],
      yaw: -10,
      length: 1024,
      width: 384,
      thickness: 64,
      material: "materials/dev/reflectivity_30.vmat",
    },
    {
      kind: "bridgeApproach",
      name: "fixture_bridge_approach",
      start: [1024, 0, 128],
      end: [2048, 0, 384],
      width: 384,
      thickness: 64,
      material: "materials/dev/reflectivity_30.vmat",
    },
    {
      kind: "ringPlatform",
      name: "fixture_ring_platform",
      center: [0, 2048, 384],
      yaw: 22.5,
      outerRadius: 768,
      innerRadius: 384,
      height: 64,
      sides: 8,
      material: "materials/dev/reflectivity_30.vmat",
    },
  ]);
  text = reconcileMapSolids(text, [
    {
      targetname: "fixture_concave_solid",
      center: [0, -1024, 128],
      material: "materials/dev/reflectivity_30.vmat",
      extrusion: {
        points: [
          [-384, -384], [384, -384], [384, -128],
          [-128, -128], [-128, 384], [-384, 384],
        ],
        height: 256,
      },
    },
    {
      targetname: "fixture_sloped_concave_solid",
      center: [1536, -1024, 256],
      material: "materials/dev/reflectivity_30.vmat",
      extrusion: {
        points: [
          [-384, -384], [384, -384], [384, -128],
          [-128, -128], [-128, 384], [-384, 384],
        ],
        bottom: [-192, -64, -64, -128, -256, -256],
        top: [64, 192, 192, 128, 0, 0],
      },
    },
    ...structures.managedSolids,
  ]).text;
  return reconcileMapNavSurfaces(text, structures.managedNavSurfaces).text;
}

export function inspectRepositoryCompileFixture(text: string): {
  entities: ReturnType<typeof parseMapEntities>;
  solids: ReturnType<typeof parseMapSolids>;
  navSurfaces: ReturnType<typeof parseMapNavSurfaces>;
  volumes: ReturnType<typeof parseMapVolumes>;
} {
  return {
    entities: parseMapEntities(text),
    solids: parseMapSolids(text),
    navSurfaces: parseMapNavSurfaces(text),
    volumes: parseMapVolumes(text),
  };
}
