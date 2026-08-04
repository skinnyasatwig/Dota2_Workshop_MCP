import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTileGridPreview } from "../src/dota/map-preview.js";
import { TileGrid } from "../src/dota/tilegrid.js";
import { ParsedMapEntity } from "../src/dota/vmap.js";
import { decodePng } from "../src/util/imgmontage.js";
import { ParsedMapBoxVolume } from "../src/dota/map-volume.js";

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
  const volumes: ParsedMapBoxVolume[] = [
    {
      targetname: "camp_bounds",
      classname: "trigger_multiple",
      recipe: "camp",
      center: [384, 768, 192],
      size: [384, 256, 384],
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
      yaw: 0,
      material: "materials/tools/toolsplayerclip.vmat",
      blocking: true,
    },
  ];
  const rendered = renderTileGridPreview(grid(), [
    entity("radiant_spawn", "info_target", "128 128 128"),
    entity("radiant_t1", "npc_dota_tower", "640 512 128", { teamnumber: "2", attack_range: "700" }),
    entity("dragon_boss_spawn", "info_target", "1152 768 128"),
    entity("radiant_top_camp_hard", "npc_dota_neutral_spawner", "384 768 128"),
    entity("river_flow_center", "info_target", "768 256 128", {}, undefined, "0 90 0"),
    entity("path_radiant_1", "path_corner", "128 512 128", {}, "path_radiant_2"),
    entity("path_radiant_2", "path_corner", "1408 512 128"),
    entity("minimap_boundary_southwest", "dota_minimap_boundary", "0 0 128"),
    entity("minimap_boundary_northeast", "dota_minimap_boundary", "1536 1024 128"),
  ], { scale: 4 }, volumes);

  const decoded = decodePng(rendered.png);
  assert.equal(decoded.width, 24);
  assert.equal(decoded.height, 16);
  assert.equal(rendered.stats.overlays.paths, 1);
  assert.equal(rendered.stats.overlays.towers, 1);
  assert.equal(rendered.stats.overlays.camps, 1);
  assert.equal(rendered.stats.overlays.objectives, 2);
  assert.equal(rendered.stats.overlays.currents, 1);
  assert.equal(rendered.stats.overlays.minimapBounds, 1);
  assert.equal(rendered.stats.overlays.volumes, 2);
  assert.equal(rendered.stats.overlays.blockingVolumes, 1);
  assert.equal(rendered.reachability.findings.length, 0);
  const colors = new Set<string>();
  for (let index = 0; index < decoded.rgba.length; index += 4) {
    colors.add(`${decoded.rgba[index]},${decoded.rgba[index + 1]},${decoded.rgba[index + 2]}`);
  }
  assert.ok(colors.size > 6);
});
