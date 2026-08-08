import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGalleryHtml, GalleryData } from "../src/dota/gallery.js";

const emptyGallery = (model: GalleryData["models"][number]): GalleryData => ({
  title: "Animation test",
  particles: [],
  models: [model],
  sounds: [],
  textures: [],
  modelViewerSrc: "model-viewer.min.js",
});

test("model galleries autoplay only explicitly exported checked animations", () => {
  const animated = buildGalleryHtml(emptyGallery({
    id: "M1",
    name: "Banner idle",
    game: "Dota 2",
    glb: "banner.glb",
    animationName: "banner_radiant_idle",
  }));
  assert.match(animated, /autoplay animation-name="banner_radiant_idle"/);

  const staticModel = buildGalleryHtml(emptyGallery({
    id: "M1",
    name: "Rock",
    game: "Dota 2",
    glb: "rock.glb",
  }));
  assert.doesNotMatch(staticModel, /autoplay animation-name=/);
});
