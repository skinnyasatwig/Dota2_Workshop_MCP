import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAddonInfo, registerMapInAddonInfo } from "../src/dota/addoninfo.js";

const KV3 = `<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->
{
\tHideInTools = false
\tIsPlayable = true
\tmaps = null
\tDefaultMap = ""
\tMaxPlayers = 10
\tmap_options = null
}
`;

test("KV3 addoninfo: register map without converting the file format", () => {
  const updated = registerMapInAddonInfo(KV3, "three_vs_three_blockout", 6);
  const info = parseAddonInfo(updated);
  assert.equal(info.format, "kv3");
  assert.deepEqual(info.maps, ["three_vs_three_blockout"]);
  assert.equal(info.defaultMap, "three_vs_three_blockout");
  assert.equal(info.maxPlayers, 6);
  assert.ok(updated.startsWith("<!-- kv3"));
  assert.ok(updated.includes("map_options = null"), "unrelated KV3 fields are preserved");
});

test("KV3 addoninfo: registration is idempotent and preserves existing maps", () => {
  const once = registerMapInAddonInfo(KV3, "map_one", 6);
  const twice = registerMapInAddonInfo(once, "map_one", 6);
  const withSecond = registerMapInAddonInfo(twice, "map_two", 8);
  assert.deepEqual(parseAddonInfo(twice).maps, ["map_one"]);
  assert.deepEqual(parseAddonInfo(withSecond).maps, ["map_one", "map_two"]);
  assert.equal(parseAddonInfo(withSecond).defaultMap, "map_one");
  assert.equal(parseAddonInfo(withSecond).maxPlayers, 8);
});

test("KV1 addoninfo: register map and per-map MaxPlayers", () => {
  const source = `"AddonInfo"\n{\n\t"maps" "existing"\n\t"IsPlayable" "1"\n}\n`;
  const updated = registerMapInAddonInfo(source, "new_map", 6);
  const info = parseAddonInfo(updated);
  assert.equal(info.format, "kv1");
  assert.deepEqual(info.maps, ["existing", "new_map"]);
  assert.match(updated, /"new_map"\s*\{/);
  assert.match(updated, /"MaxPlayers"\s+"6"/);
});
