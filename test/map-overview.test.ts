import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  inspectMapOverview,
  mapOverviewDisplayUvToWorld,
  mapOverviewWorldToDisplayUv,
  parseMapOverviewMetadata,
} from "../src/dota/map-overview.js";
import { buildEntityBlock } from "../src/dota/vmap.js";
import { encodeRgbaPng } from "../src/util/png.js";

function mapWithBounds(minX = -200, minY = -100, maxX = 200, maxY = 100): string {
  return [
    buildEntityBlock({
      classname: "dota_minimap_boundary",
      origin: `${minX} ${minY} 0`,
      properties: { targetname: "minimap_southwest" },
    }, 1),
    buildEntityBlock({
      classname: "dota_minimap_boundary",
      origin: `${maxX} ${maxY} 0`,
      properties: { targetname: "minimap_northeast" },
    }, 2),
  ].join("\n");
}

async function fixture(options: {
  scale?: number;
  rotate?: number;
  width?: number;
  height?: number;
  compiled?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "d2-overview-"));
  const gameDir = join(root, "game");
  const contentDir = join(root, "content");
  const overview = join(gameDir, "resource", "overviews", "fixture.txt");
  const material = join(contentDir, "materials", "overviews", "fixture.vmat");
  const texture = join(contentDir, "materials", "overviews", "fixture.png");
  await Promise.all([mkdir(dirname(overview), { recursive: true }), mkdir(dirname(material), { recursive: true })]);
  await writeFile(overview, `"fixture"
{
  "material" "materials/overviews/fixture.vmat"
  "pos_x" "-200"
  "pos_y" "100"
  "scale" "${options.scale ?? 100}"
  "rotate" "${options.rotate ?? 0}"
  "zoom" "1"
}`);
  await writeFile(material, `"Layer0"
{
  "Shader" "ui.vfx"
  "Texture" "materials/overviews/fixture.png"
}`);
  const width = options.width ?? 4;
  const height = options.height ?? 2;
  await writeFile(texture, encodeRgbaPng(width, height, Buffer.alloc(width * height * 4, 255)));
  if (options.compiled) {
    await mkdir(join(gameDir, "materials", "overviews"), { recursive: true });
    await Promise.all([
      writeFile(join(gameDir, "materials", "overviews", "fixture.vmat_c"), "compiled"),
      writeFile(join(gameDir, "materials", "overviews", "fixture_png_1234abcd.vtex_c"), "compiled"),
    ]);
  }
  return { root, gameDir, contentDir };
}

test("Valve overview metadata parses quoted and unquoted scalar keys", () => {
  assert.deepEqual(parseMapOverviewMetadata(`fixture
  {
    material materials/overviews/fixture.vmat
    pos_x -200
    pos_y 100
    scale 100
  }`), {
    name: "fixture",
    material: "materials/overviews/fixture.vmat",
    posX: -200,
    posY: 100,
    scale: 100,
    rotate: 0,
    zoom: undefined,
  });
  assert.equal(parseMapOverviewMetadata(`fixture
  {
    material materials/overviews/fixture.vmat
    pos_x -200
    pos_y 100
    scale 100
    rotate 15
  }`).rotate, 15, "Valve ships nonzero legacy flag values other than 1");
  assert.throws(() => parseMapOverviewMetadata(`fixture
  {
    material materials/overviews/fixture.vmat
    pos_x -200
    pos_y 100
    scale 100
    rotate 0.5
  }`), /legacy 0\/nonzero flag/);
});

test("legacy nonzero rotation maps the displayed overview through one clockwise quarter-turn", () => {
  const metadata = { posX: -200, posY: 100, scale: 100, rotate: 15 };
  const image = { width: 4, height: 4 };
  assert.deepEqual(
    mapOverviewDisplayUvToWorld(metadata, image, { u: 0, v: 0.5 }),
    { x: 0, y: -300 },
    "the displayed west edge is the source image's south edge",
  );
  assert.deepEqual(
    mapOverviewDisplayUvToWorld(metadata, image, { u: 0.5, v: 0 }),
    { x: -200, y: -100 },
    "the displayed north edge is the source image's west edge",
  );
  const world = { x: -100, y: 0 };
  const display = mapOverviewWorldToDisplayUv(metadata, image, world);
  assert.deepEqual(display, { u: 0.75, v: 0.25 });
  assert.deepEqual(mapOverviewDisplayUvToWorld(metadata, image, display), world);
  assert.throws(
    () => mapOverviewDisplayUvToWorld({ ...metadata, rotate: 0.5 }, image, { u: 0.5, v: 0.5 }),
    /integer legacy flag/,
  );
  assert.throws(
    () => mapOverviewDisplayUvToWorld({ ...metadata, scale: 0 }, image, { u: 0.5, v: 0.5 }),
    /positive scale/,
  );
});

test("overview validation proves assets and the world-to-image transform", async () => {
  const current = await fixture({ compiled: true });
  try {
    const report = await inspectMapOverview({
      mapName: "fixture",
      mapText: mapWithBounds(),
      gameDir: current.gameDir,
      contentDir: current.contentDir,
      requireCompiledAssets: true,
    });
    assert.equal(report.configured, true);
    assert.deepEqual(report.image, { width: 4, height: 2 });
    assert.deepEqual(report.projectedBounds, { minX: -200, minY: -100, maxX: 200, maxY: 100 });
    assert.deepEqual(report.entityBounds, report.projectedBounds);
    assert.deepEqual(report.findings, []);
    assert.match(report.compiledTexturePath ?? "", /fixture_png_1234abcd\.vtex_c$/);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("overview validation reports transform drift and missing compiled assets", async () => {
  const current = await fixture({ scale: 90 });
  try {
    const report = await inspectMapOverview({
      mapName: "fixture",
      mapText: mapWithBounds(),
      gameDir: current.gameDir,
      contentDir: current.contentDir,
      requireCompiledAssets: true,
    });
    assert.deepEqual(report.findings.map((finding) => finding.code).sort(), [
      "minimap-material-compiled-missing",
      "minimap-texture-compiled-missing",
      "minimap-transform-mismatch",
    ]);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("overview validation proves Valve's nonzero quarter-turn convention", async () => {
  const current = await fixture({ rotate: 15, width: 4, height: 4, compiled: true });
  try {
    const report = await inspectMapOverview({
      mapName: "fixture",
      mapText: mapWithBounds(-200, -300, 200, 100),
      gameDir: current.gameDir,
      contentDir: current.contentDir,
      requireCompiledAssets: true,
    });
    assert.equal(report.displayQuarterTurnsClockwise, 1);
    assert.deepEqual(report.projectedBounds, { minX: -200, minY: -300, maxX: 200, maxY: 100 });
    assert.deepEqual(report.findings, []);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("rotated overview validation rejects a non-square source image", async () => {
  const current = await fixture({ rotate: 1 });
  try {
    const report = await inspectMapOverview({
      mapName: "fixture",
      mapText: mapWithBounds(),
      gameDir: current.gameDir,
      contentDir: current.contentDir,
    });
    assert.ok(report.findings.some((finding) =>
      finding.code === "minimap-transform-invalid" && /square image/.test(finding.detail),
    ));
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("overview assets cannot escape the addon content tree", async () => {
  const current = await fixture();
  try {
    await writeFile(join(current.gameDir, "resource", "overviews", "fixture.txt"), `fixture
    {
      material ../outside.vmat
      pos_x -200
      pos_y 100
      scale 100
    }`);
    const report = await inspectMapOverview({
      mapName: "fixture",
      mapText: mapWithBounds(),
      gameDir: current.gameDir,
      contentDir: current.contentDir,
    });
    assert.equal(report.findings[0]?.code, "minimap-material-path-invalid");
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("an entirely unconfigured minimap is a warning rather than a false transform claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "d2-overview-empty-"));
  try {
    const report = await inspectMapOverview({
      mapName: "fixture",
      mapText: "",
      gameDir: join(root, "game"),
      contentDir: join(root, "content"),
    });
    assert.deepEqual(report.findings, [{
      severity: "warn",
      code: "minimap-unconfigured",
      detail: "No minimap boundary entities or overview metadata are configured.",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
