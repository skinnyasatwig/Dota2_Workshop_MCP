import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectMapOverview, parseMapOverviewMetadata } from "../src/dota/map-overview.js";
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

async function fixture(options: { scale?: number; compiled?: boolean } = {}) {
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
  "rotate" "0"
  "zoom" "1"
}`);
  await writeFile(material, `"Layer0"
{
  "Shader" "ui.vfx"
  "Texture" "materials/overviews/fixture.png"
}`);
  await writeFile(texture, encodeRgbaPng(4, 2, Buffer.alloc(4 * 2 * 4, 255)));
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
