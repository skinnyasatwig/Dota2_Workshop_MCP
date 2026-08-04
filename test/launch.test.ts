import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDirectDotaLaunchTarget, buildDotaLaunchTarget } from "../src/dota/launch.js";

const root = String.raw`C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta`;
const dota = String.raw`C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\bin\win64\dota2.exe`;
const args = ["-tools", "-addon", "example"];

test("Windows launch uses Steam when steam.exe exists", () => {
  const target = buildDotaLaunchTarget(root, dota, args, {
    platform: "win32",
    pathExists: (path) => path === String.raw`C:\Program Files (x86)\Steam\steam.exe`,
  });

  assert.equal(target.method, "steam");
  assert.equal(target.executable, String.raw`C:\Program Files (x86)\Steam\steam.exe`);
  assert.deepEqual(target.args, ["-applaunch", "570", ...args]);
});

test("Windows launch falls back to dota2.exe when Steam is unavailable", () => {
  const target = buildDotaLaunchTarget(root, dota, args, {
    platform: "win32",
    pathExists: () => false,
  });

  assert.equal(target.method, "direct");
  assert.equal(target.executable, dota);
  assert.deepEqual(target.args, args);
});

test("Windows launch can use Steam from a different library root", () => {
  const steamExe = String.raw`C:\Program Files (x86)\Steam\steam.exe`;
  const externalRoot = String.raw`D:\SteamLibrary\steamapps\common\dota 2 beta`;
  const externalDota = String.raw`D:\SteamLibrary\steamapps\common\dota 2 beta\game\bin\win64\dota2.exe`;
  const target = buildDotaLaunchTarget(externalRoot, externalDota, args, {
    platform: "win32",
    steamExe,
    pathExists: (path) => path === steamExe,
  });

  assert.equal(target.method, "steam");
  assert.equal(target.executable, steamExe);
});

test("non-Windows launch remains direct", () => {
  const target = buildDotaLaunchTarget("/games/dota", "/games/dota/game/bin/linuxsteamrt64/dota2", args, {
    platform: "linux",
    pathExists: () => true,
  });

  assert.equal(target.method, "direct");
  assert.equal(target.executable, "/games/dota/game/bin/linuxsteamrt64/dota2");
});

test("explicit direct launch keeps the installed executable and arguments", () => {
  const target = buildDirectDotaLaunchTarget(dota, args, "win32");
  assert.equal(target.method, "direct");
  assert.equal(target.executable, dota);
  assert.deepEqual(target.args, args);
  assert.equal(target.cwd, String.raw`C:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\game\bin\win64`);
});
