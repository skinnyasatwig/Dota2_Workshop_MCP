import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMapNavSurfaceClearance,
  buildMapNavSurfaceBlock,
  DOTA_NAV_WALKABLE_MATERIAL,
  parseManagedMapNavSurfaces,
  parseMapNavSurfaces,
  reconcileMapNavSurfaces,
} from "../src/dota/map-nav-surface.js";
import { TileGrid } from "../src/dota/tilegrid.js";

const EMPTY_VMAP_TEXT = `<!-- dmx encoding keyvalues2 1 format vmap 35 -->
"root" "CMapRootElement"
{
  "world" "CMapWorld"
  {
    "id" "elementid" "00000000-0000-0000-0000-000000000001"
    "nodeID" "int" "1"
    "children" "element_array" [ ]
  }
}`;

const flat = {
  targetname: "center_bridge_deck",
  center: [640, 384, 320] as [number, number, number],
  yaw: 15,
  extrusion: {
    points: [[-512, -192], [512, -192], [512, 192], [-512, 192]] as [number, number][],
    height: 64,
  },
};

test("checked navigation surfaces use Valve's dedicated walkable material", () => {
  const block = buildMapNavSurfaceBlock(flat, 40, 41);
  assert.match(block, /"CMapGroup"/);
  assert.match(block, /MCP Nav Surface: center_bridge_deck/);
  assert.match(block, new RegExp(DOTA_NAV_WALKABLE_MATERIAL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(block, /"physicsType" "string" "default"/);
  assert.match(block, /"nodeID" "int" "40"/);
  assert.match(block, /"nodeID" "int" "41"/);
});

test("navigation surface geometry is checked through the watertight solid writer", () => {
  const [sloped] = parseManagedMapNavSurfaces([{
    ...flat,
    extrusion: {
      points: flat.extrusion.points,
      bottom: [-64, -64, -64, -64],
      top: [32, 96, 96, 32],
    },
  }])!;
  assert.deepEqual(sloped.extrusion, {
    points: flat.extrusion.points,
    bottom: [-64, -64, -64, -64],
    top: [32, 96, 96, 32],
  });
  assert.throws(
    () => parseManagedMapNavSurfaces([{ ...flat, extrusion: { points: [[0, 0], [1, 1], [2, 2]], height: 64 } }]),
    /enclose more than one square world unit|collinear/,
  );
});

test("managed navigation surfaces reconcile idempotently and expose deck shape", () => {
  const added = reconcileMapNavSurfaces(EMPTY_VMAP_TEXT, [flat]);
  assert.deepEqual(added.added, [flat.targetname]);
  assert.equal(added.updated.length, 0);
  const parsed = parseMapNavSurfaces(added.text);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    targetname: flat.targetname,
    center: flat.center,
    yaw: 15,
    footprint: flat.extrusion.points,
    height: 64,
    material: DOTA_NAV_WALKABLE_MATERIAL,
  });

  const unchanged = reconcileMapNavSurfaces(added.text, [flat]);
  assert.deepEqual(unchanged.unchanged, [flat.targetname]);
  assert.equal(unchanged.text, added.text);

  const changed = reconcileMapNavSurfaces(added.text, [{ ...flat, yaw: 90 }]);
  assert.deepEqual(changed.updated, [flat.targetname]);
  assert.equal(parseMapNavSurfaces(changed.text)[0].yaw, 90);
});

function terrain(level: number): TileGrid {
  return {
    width: 4,
    height: 4,
    vw: 5,
    vh: 5,
    origin: [0, 0, 0],
    tileSize: 256,
    heights: new Array(25).fill(level),
    water: new Array(25).fill(0),
    tileset: new Array(16).fill(0),
    orientations: new Array(16).fill(0),
    configurations: new Array(16).fill(undefined).map(() => [5292, -1]),
    pathEdges: new Array(40).fill(0),
  };
}

test("offline deck analysis reports conservative underpass clearance without claiming deck routes", () => {
  const surface = parseMapNavSurfaces(reconcileMapNavSurfaces(EMPTY_VMAP_TEXT, [{
    ...flat,
    center: [512, 512, 512],
    yaw: 0,
  }]).text);
  const clear = analyzeMapNavSurfaceClearance(terrain(0), surface);
  assert.deepEqual(clear, [{
    targetname: flat.targetname,
    overlappingCellCount: 8,
    fullyInsideGrid: true,
    deckBottomWorldZ: [480, 480],
    deckTopWorldZ: [544, 544],
    terrainWorldZ: [128, 128],
    minimumUnderpassClearance: 352,
    agentHeight: 256,
    underpassClearAtAgentHeight: true,
    deckConnectivity: "engine-navigation-required",
  }]);
  const blocked = analyzeMapNavSurfaceClearance(terrain(1), surface);
  assert.equal(blocked[0].minimumUnderpassClearance, 96);
  assert.equal(blocked[0].underpassClearAtAgentHeight, false);
});
