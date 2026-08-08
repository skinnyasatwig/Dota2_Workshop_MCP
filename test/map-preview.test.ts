import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTileGridPreview } from "../src/dota/map-preview.js";
import { TileGrid } from "../src/dota/tilegrid.js";
import { ParsedMapEntity } from "../src/dota/vmap.js";
import { decodePng } from "../src/util/imgmontage.js";
import { ParsedMapVolume } from "../src/dota/map-volume.js";
import { ParsedMapSolid } from "../src/dota/map-solid.js";
import { ParsedMapNavSurface } from "../src/dota/map-nav-surface.js";

function grid(width = 6, height = 4): TileGrid {
  return {
    width,
    height,
    vw: width + 1,
    vh: height + 1,
    origin: [0, 0, 0],
    tileSize: 256,
    heights: new Array((width + 1) * (height + 1)).fill(0),
    water: new Array((width + 1) * (height + 1)).fill(0),
    tileset: new Array(width * height).fill(0),
    orientations: new Array(width * height).fill(0),
    configurations: new Array(width * height).fill(undefined).map(() => [5292, -1]),
    pathEdges: new Array(width * (height + 1) + (width + 1) * height).fill(0),
  };
}

function entity(
  targetname: string,
  classname: string,
  origin: string,
  properties: Record<string, string> = {},
  target?: string,
  angles = "0 0 0",
): ParsedMapEntity {
  return {
    targetname,
    classname,
    origin,
    angles,
    target,
    properties: { targetname, classname, ...properties, ...(target ? { target } : {}) },
  };
}

test("diagnostic preview renders gameplay and navigation overlays", () => {
  const volumes: ParsedMapVolume[] = [
    {
      targetname: "camp_bounds",
      classname: "trigger_multiple",
      recipe: "camp",
      center: [384, 768, 192],
      size: [384, 256, 384],
      footprint: [[-192, -128], [192, -128], [192, 128], [-192, 128]],
      yaw: 20,
      material: "materials/tools/toolstrigger.vmat",
      blocking: false,
    },
    {
      targetname: "north_wall",
      classname: "func_brush",
      recipe: "playerClip",
      center: [768, 896, 256],
      size: [512, 128, 512],
      footprint: [[-256, -64], [256, -64], [256, 64], [-256, 64]],
      sloped: {
        bottom: [-128, -128, 0, 0],
        top: [128, 128, 256, 256],
      },
      yaw: 0,
      material: "materials/tools/toolsplayerclip.vmat",
      blocking: true,
    },
  ];
  const solids: ParsedMapSolid[] = [{
    targetname: "concave_base_wall",
    center: [1280, 896, 256],
    yaw: 0,
    material: "materials/dev/reflectivity_30.vmat",
    footprint: [[-96, -96], [96, -96], [96, -32], [-32, -32], [-32, 96], [-96, 96]],
    sloped: {
      bottom: [-256, -128, -128, -192, -320, -320],
      top: [0, 128, 128, 64, -64, -64],
    },
    blocking: true,
  }];
  const navSurfaces: ParsedMapNavSurface[] = [{
    targetname: "preview_bridge_walkable",
    center: [768, 512, 384],
    yaw: 15,
    footprint: [[-256, -96], [256, -96], [256, 96], [-256, 96]],
    sloped: {
      bottom: [-64, 0, 0, -64],
      top: [0, 64, 64, 0],
    },
    material: "materials/editor/dota_nav_walkable.vmat",
  }];
  const rendered = renderTileGridPreview(grid(), [
    entity("radiant_spawn", "info_target", "128 128 128"),
    entity("radiant_t1", "npc_dota_tower", "640 512 128", { teamnumber: "2", attack_range: "700" }),
    entity("dragon_boss_spawn", "info_target", "1152 768 128"),
    entity("radiant_top_camp_hard", "npc_dota_neutral_spawner", "384 768 128"),
    entity("river_flow_center", "info_target", "768 256 128", {}, undefined, "0 90 0"),
    entity("path_radiant_1", "path_corner", "128 512 128", {}, "path_radiant_2"),
    entity("path_radiant_2", "path_corner", "1408 512 128"),
    entity("fow_wall_1", "ent_fow_blocker_node", "256 896 256", { TargetNode: "fow_wall_2" }),
    entity("fow_wall_2", "ent_fow_blocker_node", "1280 896 256"),
    entity("minimap_boundary_southwest", "dota_minimap_boundary", "0 0 128"),
    entity("minimap_boundary_northeast", "dota_minimap_boundary", "1536 1024 128"),
    entity("preview_tree", "ent_dota_tree", "128 896 128"),
    entity("preview_statue", "prop_static", "1408 128 128", { solid: "6" }),
  ], {
    scale: 4,
    visualPropFootprints: [{
      id: "preview_bush",
      sourceIndex: 13,
      targetname: "preview_bush",
      model: "models/props_nature/bush_00.vmdl",
      palette: "radiant-underbrush",
      variant: "bush-round",
      points: [[1152, 128], [1280, 128], [1280, 256], [1152, 256]],
      minZ: 128,
      maxZ: 192,
      source: "crc-matched-render-bounds",
    }],
  }, volumes, solids, navSurfaces);

  const decoded = decodePng(rendered.png);
  assert.equal(decoded.width, 24);
  assert.equal(decoded.height, 16);
  assert.equal(rendered.stats.overlays.paths, 1);
  assert.equal(rendered.stats.overlays.towers, 1);
  assert.equal(rendered.stats.overlays.camps, 1);
  assert.equal(rendered.stats.overlays.objectives, 2);
  assert.equal(rendered.stats.overlays.currents, 1);
  assert.equal(rendered.stats.overlays.minimapBounds, 1);
  assert.equal(rendered.stats.overlays.solids, 1);
  assert.equal(rendered.stats.overlays.slopedSolids, 1);
  assert.equal(rendered.stats.overlays.navSurfaces, 1);
  assert.equal(rendered.stats.overlays.slopedNavSurfaces, 1);
  assert.equal(rendered.navSurfaceClearance.length, 1);
  assert.equal(rendered.navSurfaceClearance[0].deckConnectivity, "engine-navigation-required");
  assert.equal(rendered.stats.overlays.volumes, 2);
  assert.equal(rendered.stats.overlays.slopedVolumes, 1);
  assert.equal(rendered.stats.overlays.blockingVolumes, 2);
  assert.equal(rendered.stats.overlays.visionBlockers, 1);
  assert.equal(rendered.stats.overlays.collisionObstacles, 2);
  assert.equal(rendered.stats.overlays.visualProps, 1);
  assert.equal(rendered.reachability.findings.length, 0);
  const colors = new Set<string>();
  for (let index = 0; index < decoded.rgba.length; index += 4) {
    colors.add(`${decoded.rgba[index]},${decoded.rgba[index + 1]},${decoded.rgba[index + 2]}`);
  }
  assert.ok(colors.size > 6);
});
