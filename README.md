# Dota 2 Workshop MCP

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude Code, Claude
Desktop, Cursor, …) develop **Dota 2 custom games** with the Workshop Tools: edit KeyValues,
scaffold abilities/modifiers/items/units/heroes/Panorama, search the VScript (Lua) modding API,
and build & launch the game.

It is **template-aware**: for a [ModDota TypeScript addon
template](https://github.com/ModDota/TypeScript-Addon-Template) it scaffolds **TypeScript**
(`@registerAbility` / `@registerModifier`, KV `ScriptFile` pointing at the compiled `.lua`, `#base`
wiring) and drives the template's `npm` scripts. It also has a raw-Lua + `resourcecompiler.exe`
fallback for non-tstl addons.

> Status: working — **122 tools**, end-to-end tested. It can search the Workshop for custom games by
> name and download them outside the client (SteamCMD) to study, generates whole playable maps from a spec
> (terrain shaping via the Dota tile grid + entities + waypoint paths → compile → .vpk), previews them
> top-down as an image without launching the game, edits KV1 + KV3 (soundevents/particles) data, reads
> base-game files straight out of the VPKs, and scaffolds TS/Lua content, Panorama, custom events & net
> tables, and can read/learn from any subscribed custom game's files. The live debug loop runs
> over the **VConsole2** protocol (verified against a running client: connect, send commands, read live
> output, hot-reload, restart, screenshot, error-watch) and a bundled, searchable copy of the VScript
> API, the Panorama JS API, the ModDota guides, and a knowledge base of design patterns distilled from
> shipping games (`dota_patterns`) ships for offline use. `scaffold_td` emits both the canonical
> waypoint tower-defense director and, with `maze: true`, a GemTD-style maze TD (grid A* pathfinder +
> build validation that never lets players fully wall off the path).

## Features

| Area | Tools |
| --- | --- |
| **Diagnostics & status** | `dota_doctor`, `addon_list`, `addon_info`, `dota_status`, `addon_audit` |
| **KeyValues** | `kv_read`, `kv_get_entry`, `kv_upsert_entry`, `kv_remove_entry`, `kv_validate`, `kv_format` |
| **Scaffolding** | `scaffold_ability`, `scaffold_modifier`, `scaffold_item`, `scaffold_unit`, `scaffold_hero`, `scaffold_panorama_panel` |
| **Systems scaffolders** | `scaffold_notifications`, `scaffold_nettable_binding`, `scaffold_rpc`, `scaffold_save_codes`, `scaffold_hud_panel`, `scaffold_wave_system`, `scaffold_shop`, `scaffold_talent_tree` (battle-tested infra distilled from shipping games) |
| **VScript API** | `lua_api_search`, `lua_api_get`, `lua_api_class_methods` |
| **Build & launch** | `addon_build`, `addon_compile_content`, `addon_launch_tools`, `addon_launch_custom_game`, `addon_link` |
| **Live debug loop** | `dota_send_console_command`, `dota_read_console_log`, `dota_reload_scripts`, `dota_restart_game`, `dota_dev_cycle`, `dota_screenshot`, `dota_watch_errors`, `dota_wait_for`, `dota_perf` |
| **Window & input** | `dota_window`, `dota_focus_window`, `dota_click`, `dota_type`, `dota_input` |
| **In-game DebugSDK** | `addon_attach_debug_sdk`, `addon_detach_debug_sdk`, `dota_lua_eval`, `dota_debug_dump`, `dota_selftest` |
| **Reference library** | `ref_harvest`, `ref_harvest_top`, `ref_list`, `ref_search`, `ref_find`, `ref_passport`, `ref_inspect`, `ref_get`, `ref_recipe`, `ref_curate`, `ref_stats`, `asset_db` (SQLite index: fast structured search by kind/ext/name) |
| **Docs & references** | `docs_search`, `docs_get`, `docs_list`, `dota_patterns`, `panorama_api_search`, `panorama_api_get`, `tools_catalog` |
| **Maps** | `map_create`, `map_add_entity`, `map_inspect`, `map_patch_entities`, `map_sync_contract`, `map_rewrite_path`, `map_to_text`, `map_from_text`, `map_compile`, `map_list`, `map_validate`, `map_engine_readiness_probe`, `map_engine_nav_test`, `map_engine_visual_test`, `map_engine_animation_test` |
| **Map generation** | `map_build`, `map_compare_specifications`, `map_terrain`, `map_preview`, `map_tile_to_world`, `map_recipe_catalog`, `entity_catalog`, `scaffold_td` |
| **Reference games** | `workshop_search`, `workshop_download`, `workshop_list`, `workshop_inspect`, `workshop_read`, `workshop_grep`, `panorama_decompile` |
| **Asset preview (out of engine)** | `asset_preview` (particles/textures/models → inline contact-sheet image + HTML gallery), `sound_preview` (sounds → inline waveform/icon image + playable HTML soundboard + inline audio), `preview_studio` / `preview_studio_stop` (interactive gallery + optional public share link: animated particles, 3D models, audio players, click-to-select), `palette_preview` (exact CRC-checked four-model scenery palette → local interactive 3D gallery), `animated_prop_preview` (exact CRC-checked animated recipe → autoplaying per-sequence 3D gallery), `preview_pick` / `preview_selections` (resolve the IDs the user picked/clicked → game + asset path) — decoded via ValveResourceFormat, no Dota launch |
| **Sounds & KV3** | `soundevents_list`, `soundevents_get`, `soundevents_upsert`, `kv3_read` |
| **Assets & base game** | `assets_list`, `assets_search`, `vpk_find`, `vpk_read`, `base_kv_entry` |
| **Events & net tables** | `scaffold_custom_event`, `scaffold_net_table` |

Everything is bundled so search works **offline**:
- VScript (Lua) API — 97 classes / 242 globals / 72 enums, from [@moddota/dota-data](https://github.com/ModDota/dota-data).
- Panorama JS API — 62 interfaces / ~880 members / 18 globals, from [@moddota/panorama-types](https://github.com/ModDota/TypeScriptDeclarations).
- 93 guide pages: 83 ModDota articles (scripting, abilities, modifiers, units, panorama, assets, tools) from
  [moddota.com](https://moddota.com), a task-oriented **Custom Game Cookbook** index (`guides/custom-game-cookbook`)
  tying the tools/docs/patterns together, plus nine hand-authored references bundled with the MCP — **Particles &
  Effects in Panorama** (`panorama/particles-and-effects`) and the **Dota 2 Panorama CSS Reference**
  (`panorama/dota-css-reference`), and seven docs *distilled from a deep analysis of 34 shipping custom games*: the
  **Panorama Animations & Effects Cookbook** (`panorama/animations-cookbook`), **Custom Game HUD & UX Patterns**
  (`panorama/hud-ux-patterns`), **Custom Game Architecture & Systems Patterns** (`scripting/custom-game-architecture`),
  **Particles, Sound & Game Feel** (`scripting/particles-sound-gamefeel`), **AI & Combat Patterns**
  (`scripting/ai-combat-patterns`), **Hijacking & Extending Dota's Native HUD** (`panorama/native-hud-hijacking`),
  and **Advanced Techniques & Engine-Limit Workarounds** (`scripting/advanced-techniques`).
- A `dota_patterns` knowledge base of **77** reusable engineering patterns, each attributed to the shipping games
  it was learned from (distilled from a 58-game decompiled reference corpus).
- A curated catalog of Dota 2 modding tools, libraries and references.

Refresh the bundled data anytime with `npm run build:data` (re-fetches all of the above).

## Requirements

- Node.js ≥ 18 (developed on Node 25)
- Dota 2 + the free **Dota 2 Workshop Tools** DLC installed
- Windows (build/launch shell out to `dota2.exe` / `resourcecompiler.exe`; KV + API tools are cross-platform)

## Install

```bash
git clone https://github.com/ex3lite/Dota2_Workshop_MCP.git
cd Dota2_Workshop_MCP
npm install        # also builds via the prepare script
npm run build:data # (optional) refresh bundled VScript API + Panorama API + ModDota guides
```

`npm install` runs `npm run build`, producing `dist/index.js` (the server entry point).

## Configure

The server needs to know two things:

- **Which addon project** you're working on — set `DOTA2_ADDON_DIR` to the addon root (the folder
  with `package.json` / `game` / `content`), or pass `projectRoot` to any tool.
- **Where Dota 2 is** — auto-detected from the Windows registry + `libraryfolders.vdf`. Override
  with `DOTA2_PATH` (point it at your `dota 2 beta` folder) if detection fails.

### Claude Code

Copy [`examples/claude-code.mcp.json`](examples/claude-code.mcp.json) to your addon repo as
`.mcp.json` (adjust the two paths), or:

```bash
claude mcp add dota2-workshop --env DOTA2_ADDON_DIR=C:\path\to\addon -- node C:\path\to\Dota2_Workshop_MCP\dist\index.js
```

### Claude Desktop

Merge [`examples/claude-desktop.config.json`](examples/claude-desktop.config.json) into
`%APPDATA%\Claude\claude_desktop_config.json` (absolute paths; restart the app).

### Cursor / other IDEs

Use [`examples/cursor.mcp.json`](examples/cursor.mcp.json) at `.cursor/mcp.json` or
`~/.cursor/mcp.json`. Any stdio MCP client works — only the config location differs.

## Typical flow

1. `dota_doctor` — confirm Dota is found, the addon is detected, and it's linked into `dota_addons`.
2. `scaffold_ability` `{ name: "my_hero_fireball", behavior: "point" }` — writes the TS source, the
   `npc_abilities_custom.txt` block, and localization tokens.
3. `lua_api_search` / `lua_api_get` — look up the exact VScript signatures while writing the logic.
4. `addon_build` — compile TypeScript → Lua (`npm run build`).
5. `addon_launch_custom_game` `{ map: "..." }` — boot tools mode through Steam and start the map.

All build/launch tools accept `dryRun: true` to preview the exact command without running it.

## Live debugging & iteration

The debug tools drive a running game through the **VConsole2** protocol — the same channel
`vconsole2.exe` uses. In `-tools` mode the game listens on `127.0.0.1:29000` (override with
`-vconport`, or the `DOTA2_VCONPORT` env var on the MCP side). This is the reliable path on Windows:
the classic `-netconport` telnet console has been broken on Windows since 2023, and `console.log` is
buffered until the client exits — so live output is read from the VConsole `PRNT` stream instead.

The launch tools already pass `-tools` (and `-vconport`), so the channel is available after
`addon_launch_custom_game`. Then:

- **`dota_send_console_command`** — run any console command and get back the output it printed.
- **`dota_read_console_log`** — read recent live console output (with optional `grep`).
- **`dota_reload_scripts`** — compile + `script_reload` (hot-reload Lua without relaunch).
- **`dota_restart_game`** — `taskkill` + relaunch + reconnect (for changes that can't hot-reload).
- **`dota_dev_cycle`** — one call: build, then pick the cheapest apply path (with `autoRestart` if a reload errors).
- **`dota_screenshot`** — default **`auto`** safely captures the focused Dota window, then tries offscreen
  `PrintWindow` if Windows refuses focus. It will not capture another foreground application. **`game`** explicitly
  invokes Source 2's renderer-native `png_screenshot` by default. It accepts only a newly created, stable image,
  rejects black/uniform pixels, and retains Valve's source file. Explicit JPEG remains available but is never selected
  automatically because some Workshop sessions crash in that renderer path.
- **`dota_watch_errors`** — scan the live console for Lua/engine errors (script error, stack traceback, *.lua:NN, …).
- **`dota_wait_for`** — block until a console line matches (optionally after sending a command) — for sequencing tests.

What hot-reloads vs needs a restart:

| Change | Action |
| --- | --- |
| Lua function bodies | `dota_reload_scripts` (`script_reload`) |
| Panorama (xml/css/js) | auto-reloads after compile — no relaunch |
| KV files (`npc_*_custom.txt`) | `dota_restart_game` (full relaunch) |
| New/removed scripts, changed class structure, registrations | `dota_restart_game` |

> Tip: the ModDota template uses `Dynamic_Wrap`/`GameRules.Addon.Reload()` so reloaded code is
> picked up — keep event listeners wrapped for `script_reload` to take effect.

## Window control & input injection

Drive the game window and inject mouse/keyboard at the OS level (Windows). Coordinates are **client-relative** by
default (the render area's top-left), so they line up with what a `window` screenshot shows; use `nx`/`ny` for a
fraction of the client area. Everything is batched into a single PowerShell call per tool so sequences run fast.

- **`dota_focus_window`** — focus (`focus:true`, beats the Windows foreground lock via `AttachThreadInput`) or send to
  back (`focus:false`). Focus is needed before reliable clicks.
- **`dota_window`** — `info` (geometry + foreground/minimized state), `focus`/`unfocus`/`minimize`/`restore`/
  `maximize`/`show`/`hide`, or `move` (x/y/w/h).
- **`dota_click`** — move + click (left/right/middle, double) at `x,y` or `nx,ny`.
- **`dota_type`** — type literal `text`, or send `keys` chords (`{ENTER}`, `{ESC}`, `^a`, …).
- **`dota_input`** — a whole `actions` sequence (`move`/`click`/`down`/`up`/`drag`/`scroll`/`key`/`text`/`sleep`) in one
  fast call — the way to script a self-test interaction.

## In-game DebugSDK + self-test

The **DebugSDK** is a self-contained Lua module bundled with the MCP. Attach it to any addon and it registers `mcp_*`
console commands the MCP drives over VConsole for **deterministic** control and inspection — the fast, reliable path for
self-testing (no pixel guessing).

- **`addon_attach_debug_sdk`** — copy `mcp_debug.lua` into the addon and wire `require("mcp_debug")` into the game-mode
  bootstrap (TS *or* Lua). Idempotent; `addon_detach_debug_sdk` reverses it. Then `addon_build` (tstl) + `dota_restart_game`.
- **`dota_lua_eval`** — run a Lua snippet on the live server and get the JSON result (`mcp_eval`).
- **`dota_debug_dump`** — dump game state as JSON: `state` (time/phase/players), `heroes`, `units` (`mcp_dump`).
- **`dota_selftest`** — one orchestrated smoke run: optionally launch a map, wait until the SDK reports that the map
  is genuinely loaded, run `commands`, check `asserts` (Lua booleans → PASS/FAIL via `mcp_assert`), watch for errors,
  and safely screenshot — returns a single pass/fail report. A project can save these settings in
  `.dota-workshop/selftest.json`; explicit tool arguments override the recipe.

Real navigation checks use the SDK's compact `mcp_nav` command. Requests carry unique IDs and long paths are chunked,
so stale VConsole history and Source 2's short console-command limit cannot corrupt a new result.
DebugSDK 1.7 also provides correlated `mcp_anim` samples for an exact named entity, `mcp_focus` for a simple server-side
camera target, and `mcp_frame` for bounded Panorama framing. The latter fixes target position, distance, yaw, pitch, and
height offset, then reports the observed camera and projected screen position before renderer evidence is allowed. The
disposable animation fixture uses those commands to verify model, sequence, cycle, game time, and framing before
comparing two renderer-native PNGs.

The SDK also exposes `mcp_spawn`, `mcp_gold`, `mcp_level`, `mcp_item`, `mcp_event` (fire a custom UI event), `mcp_camera`
(query the exact client camera/minimap geometry through the optional invisible Panorama bridge), `mcp_hud`
(clean screenshots) and `mcp_pause` — all callable via `dota_send_console_command` too.

## Reference library — collect & search shipping games

Build a **persistent, self-curating** local library of custom-game source code, then search it on demand ("how does a
shipping game do X?"). Stored under `~/.dota2-workshop-mcp/reflib` (override `DOTA2_REFLIB_DIR`).

- **`ref_harvest`** — search the Workshop by `query` (or pass `ids`), optionally `download:true` via SteamCMD, extract
  the code (lua/KV/panorama), **score code quality** (0–100; rewards substance/structure/comments, penalizes
  obfuscation), classify **topics** (tower-defense, auto-chess, arpg, arena, ui-heavy, backend, …), and index it.
- **`ref_search`** — full-text search across all extracted code, ranked so higher-quality games come first.
- **`ref_list` / `ref_inspect` / `ref_get`** — browse the library, list a game's files, read one.
- **`ref_curate`** — prune low-quality / obfuscated games (with `dryRun`). **`ref_stats`** — library summary.

## Generating maps from a description

Turn a request like *"a small square map with a central platform, ringed by a road the monsters
walk — tower defense"* into a real map:

Current automation status is summarized in [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md), with a
verified milestone log in [`docs/PROGRESS.md`](docs/PROGRESS.md) and the ordered remaining work in
[`docs/BACKLOG.md`](docs/BACKLOG.md).

- **`map_build`** — one call: clone the template, apply one validated desired-state map specification,
  register, and optionally compile it. The preferred `specification` object uses the same
  `managedTerrain` / `managedEntities` / `managedPaths` / `managedSolids` / `managedNavSurfaces` / `managedVolumes` / `spatialAssertions` vocabulary as `map_sync_contract`. A specification can
  also define reusable named `regions`, reusable `components`, and transformed `placements`; one component may
  contain local entities, paths, terrain, checked world solids, checked navigation surfaces, gameplay volumes, and
  checked `dotaComponents`. Every placement is automatically namespaced. Generated links such as a neutral camp's
  spawn volume and a fog blocker's next node follow the placed names rather than silently pointing back to the local
  template. Legacy
  `terrain` / `entities` / `paths` inputs remain compatible. See
  [`examples/map-specification.json`](examples/map-specification.json) for a complete starter. Pass
  `dryRun:true` to generate and report the plan without writing, registering, or compiling anything. The report also
  resolves every resulting VMAP material and model against addon/base content, compiled assets, and Dota/core VPKs;
  a real write refuses missing or unsafe assets before conversion begins.
- **`map_compare_specifications`** — prove that a contract refactor preserves the generated map before touching a
  VMAP. Each side can be an inline specification or a project-local JSON file. The tool validates and expands reusable
  components first, compares named entities/paths/solids/surfaces/volumes/assertions independent of declaration order, preserves
  terrain-operation order, and reports additions, removals, changed fields, and any explicitly tolerated numeric drift.
  It is read-only, requires no Dota installation, and rejects JSON paths outside the addon project (including links that
  resolve outside it).
- **`map_terrain`** — apply the shared validated terrain vocabulary to an existing map. It supports
  `fill` / `height` / `water` / `tileset` / `ramp` over `rect` / `circle` / `ring` / `path` /
  `polygon` / reusable `region` / `managedPath` shapes and regenerates valid cliff orientation and tile recipes. It is
  preview-only by default; pass `apply:true` after reviewing the exact change counts.
- **`map_preview`** — render a diagnostic top-down **image straight from the data**, no game launch.
  In addition to shaded terrain and water it overlays contours, cliff cells, ramp cells, current arrows,
  entities, complete waypoint paths, tower ranges, camps, objectives, minimap bounds, checked world solids,
  Valve navigation-walkable surfaces, conservative under-deck clearance, and trigger/blocker volumes, missing terrain
  recipes, color-coded outlines recovered from real model `PHYS` blocks (including conservative curved
  sphere/capsule outlines), pink render-only footprints for curated palette models whose installed VPK CRC still
  matches the measured MDAT bounds, explicit Valve tree/obstruction broad phases,
  collision-enabled props whose physical bounds remain unknown,
  regions unreachable from player/creep spawns, and safe one-level ramp corridors toward important isolated areas.
  Candidate ramp cells are outlined in magenta and a deterministic neutral recommendation is marked with a cyan X.
  Gameplay entities sitting on blocked terrain receive bounded nearby candidate dots plus a lime line/X toward the
  neutral nearest flat placement.
  Render-only footprints never feed collision or reachability.
  Every overlay family can be hidden.
- **`map_reachability`** — analyze the whole tile grid offline and report missing terrain recipes,
  cliff-separated regions, trapped spawns, blocked entrances, inaccessible objectives or camps, and
  waypoint segments that cross blocked cells. It recognizes generated ramps and checked player-blocking
  volume and concave world-solid footprints, treats Dota river water as walkable, and resolves collision-enabled props through
  ValveResourceFormat, preferring loose compiled models and the active addon's `pak01_dir.vpk` before the base Dota
  archive. Only collision recovered from a real non-empty model `PHYS` block is cached, transformed, previewed,
  and allowed to block covered cells; render/hitbox bounds are never substituted. Convex hull vertices project
  exactly, mesh vertices form conservative convex envelopes, and decoded sphere/capsule primitives use 32 tangent
  half-planes to make a tight outer outline that remains safely larger than the true curve under bind poses,
  pitch/yaw/roll, and non-uniform entity scale. It also warns when a
  waypoint approaches `ent_dota_tree` or `point_simple_obstruction`, using a deliberately small 64-unit broad phase
  because Valve does not publish those exact hulls in FGD. Concave mesh details, dynamic collision, team-selective
  collision, and Valve's final navmesh remain engine-test responsibilities. Set `resolveModelCollision:false` for a
  faster terrain-only pass. When a gameplay-relevant isolated region borders a safe one-level cliff corridor, the
  report also returns every bounded candidate cell, a neutral midpoint recommendation, and an exact `managedTerrain`
  `ramp` operation ready to copy into the unified specification. A spawn, camp, objective, or entrance directly on a
  cliff, hole, checked blocker, or tiny trapped shelf receives a separate bounded list of nearby flat candidates and
  one neutral nearest position. Land/water state is preserved and the default search stops at four tiles. Neither
  kind of suggestion is applied automatically.
- **`map_engine_nav_test`** — close the offline-to-engine gap with one bounded Dota launch. It compiles
  or can attach to a preserved normally launched tools session. It reads routes from the unified map specification
  (or explicit input), asks Valve's real `GridNav` for endpoint and segment reachability/path lengths through compact
  request-correlated chunks, returns structured failures, and automatically
  shuts Dota down even when a check fails. It is a dry run by default and refuses to replace an existing
  Dota session unless that permission is explicit. Its default `auto` launcher gives Steam a bounded chance
  to start the game, then uses the installed executable only when Steam created no Dota process. An explicit
  Steam launch now fails in 20 seconds when Steam does not forward `-applaunch`. When automatic startup is
  unreliable, `attachToRunningDota:true` checks a user-started, VConsole-enabled tools session without compiling,
  launching, replacing, or closing that session.
- **`map_engine_visual_test`** proves that a minimap works rather than merely validating its files. One guarded
  launch discovers the native minimap rectangle through an invisible Panorama bridge, clicks normalized west/center/
  east/north/south points, compares the real camera position with the overview transform, optionally attaches checked
  screenshots, and shuts down. It waits for game state 7 by default so evidence comes from the rendered map rather than
  Valve's state-6 team showcase; lower states require an explicit diagnostic override. It is dry-run-first and refuses
  to replace a running Dota session without explicit
  permission. Valve's legacy overview `rotate` key is handled exactly as its client source does: `0` is north-up and
  any nonzero integer applies one clockwise quarter-turn; it is not a degree value. Set `screenshotMethod:"engine"`
  (or CLI flags `--screenshots --screenshot-method=engine`) for occlusion-proof Source 2 PNG evidence. Requested
  screenshots must be newly created, stable, decodable, and non-blank.
- **`map_engine_animation_test`** turns the repository's animation fixture work into a reusable, dry-run-first map
  check. It resolves exactly one named `prop_dynamic` from the source VMAP, derives its model and matching start/idle
  sequence instead of trusting caller-supplied expectations, verifies the model is available, and reports the complete
  compile/launch/shutdown plan without changing anything by default. An applied run installs DebugSDK 1.7 plus its
  bounded camera bridge, waits for actual map-render state 7, frames the exact entity, samples its correlated sequence
  and cycle twice, scans script errors, and always shuts down the session it launched. Optional `pixelCheck:"warm"`
  adds two renderer-native PNGs and the deliberately strict warm-colour motion gate; structured cycle proof is the safe
  default because broad scene motion is not object-specific evidence. The animation and minimap tools share one tested
  owned-session lifecycle for launch, VConsole connection, exact-watchdog handling, window readiness, retained console
  evidence, and bounded shutdown. That central layer independently refuses to replace a pre-existing Dota process unless
  explicit permission reaches it; the navigation tool shares the watchdog policy while preserving its separate attach mode.
- **`map_recipe_catalog`** — inspect the named terrain cores, Radiant/Dire cliff recipes, ramp-safe
  fallbacks, checked solid-volume recipes, deterministic visual-dressing palettes, and official Valve prefab references
  used by the generator. `category:"dressing"` returns the curated palette library. `verifyInstalled:true` checks the
  prefab references, every palette model, and each measured visual-bound CRC against the current Workshop Tools install
  without opening Hammer. It also compares Steam/Dota/tools
  versions and hashes of the official tilesets, PvP prefab, FGD, and compiler against the last proven baseline. A newer
  game build with unchanged recipe sources is reported as compatible; changed source/tools files request re-verification.
  `dota_doctor` includes the same concise compatibility status.
- **`map_recipe_refresh_report`** — turn a real Valve source/tools change into an evidence-gated maintenance plan.
  The read-only report names affected recipe families, compares every authoritative hash, prepares a candidate baseline,
  and requires build, test, MCP smoke, compiler-fixture, and known-good acceptance-map evidence. It cannot update the
  trusted baseline. Run `npm run recipe:refresh-report -- --run-safe-checks` to automate the four non-engine checks;
  provide reviewed acceptance evidence separately before a maintainer records any candidate in source control.
- **`entity_catalog`** — the placeable-entity reference (spawners, `path_track` waypoints, triggers,
  lights, props, …) so you know what to place. Text searches augment the curated list with classes
  and keyvalues parsed from the installed official `dota.fgd`. Matching results also include inherited
  Valve constraints for dropdown choices, explicit numeric ranges, and named-entity destinations when declared.
- **`map_tile_to_world`** — convert tile coords to world units so terrain and entities line up.

Coordinates: terrain ops use tile units (default 64×64 grid; world = origin + tile×256); entity/path
positions use world units.

Before a live navigation test, use **`map_engine_readiness_probe`** for one diagnostic launch. It sends
only DebugSDK health pings, records every game-state transition, keeps useful startup console evidence,
enumerates visible and hidden Dota dialogs, captures the Dota window, and automatically shuts down. It
is a dry run by default and refuses to replace an existing Dota session without explicit permission.
Known fatal startup evidence ends the observation immediately, and `renderer: "dx11" | "vulkan"` provides
a bounded diagnostic override without exposing arbitrary launch arguments.

Reusable component coordinates are local. A placement uses `tileOffset` for its terrain and `worldOffset` for its
entities and paths, with optional `mirrorAxis: "x" | "y" | "xy"`. Local names are prefixed with the placement name,
so two copies cannot silently overwrite each other. A component property can explicitly refer to one of its local
targets with `@local:name`; it becomes the correct namespaced target for each copy. Region mirrors can specify an
`around` tile point, which makes map-center symmetry explicit instead of relying on duplicated coordinates.
Team identity is deliberately separate from geometry: a placement may opt into `teamSwap: true` to exchange known
stock Radiant/Dire player-start classes, team numbers 2/3, `direside`, goodguys/badguys unit names, and the exact
stock Ancient/tower/fountain model pairs. Geometric mirroring never implies ownership, and neutral or custom values
that are not one of those recognized pairs remain unchanged. Reusable exact-absence selectors follow the same
player-start class swap, so a placed cleanup rule cannot accidentally target the opposite team's spawn class.
A component may also contain its own `placements`, allowing small proven pieces to form larger reusable assemblies.
Transforms and team swaps compose at every level, while deferred `@local:` references acquire every namespace in the
chain. Missing children, duplicate local placement names, cycles, and nesting deeper than 32 levels are rejected.

For common gameplay structure, `dotaComponents` provides strongly checked `base`, `ancient`, `tower`, `fountain`,
`shop`, `camp`, `bossPit`, `playerStart`, `gate`, `baseBlocker`, `fowBlocker`, `wall`, `staticPropSet`, `staticPropPalette`, `animatedPropSet`, `arch`, `profileArch`, `bridge`,
`bridgeApproach`, `ringPlatform`, `holedPlatform`, and `multiHoledPlatform` entries. It derives team numbers, official entity classes,
stock unit/model names, tower tier names, shop/camp numeric values, base member transforms, and boss-pit terrain.
See [`examples/dota-components.json`](examples/dota-components.json). A `camp` can include an optional checked
rectangular `volume`, which creates the real `trigger_multiple` bounds referenced by its spawner. A boss pit's
`noWardsRadius` creates a real `trigger_no_wards` prism using a checked, configurable regular-polygon approximation
(32 sides and 1024 units tall by default). The polygon is circumscribed, so the requested radius is fully covered;
at 32 sides the maximum radial overshoot is under 0.5%.
`baseBlocker` uses Valve's team-aware base-gate entity. `fowBlocker` turns two or more points into uniquely named,
explicitly linked `ent_fow_blocker_node` lines; broken links are reported by map inspection/validation and drawn in previews.
The `wall` component turns an open or closed world-space outline into overlapping, checked convex `playerClip`
segments. Consecutive points may use different base elevations; each sloped segment becomes a coplanar four-sided
prism whose overlap follows the same grade. This supports practical curved, concave, and elevation-following base
silhouettes without relying on one fragile concave Source 2 solid. Add one preflighted visible `material` to generate a
matching always-solid graybox skin for every segment; the same optional top/bottom materials and bounded texture scale,
shift, rotation, and shared-alignment controls used by other checked world structures are available. Omitting `material`
retains the original blocker-only output exactly.
`staticPropSet` places one checked `models/*.vmdl` resource at one to 256 named local offsets. The set rotates as one
reusable assembly, while each prop can add its own yaw. A bounded uniform or XYZ scale (0.01 through 16) may be set for
the assembly and overridden per placement; desired-state sync repairs scale drift. Collision is mandatory and explicit:
`none` emits a non-solid decoration, while `vphysics` creates a fail-closed promise that the compiled model contains
real, decodable Valve PHYS geometry. Build, sync, compile, and validation stop before writing or expensive compiler work
when that promise cannot be proven; unrelated legacy props are not retroactively gated. Optional tint and shadow controls
use official `prop_static` properties. Whole-map model preflight verifies every resulting model as a separate existence check.
`staticPropPalette` provides the same deterministic transforms and bounded scale for a named, curated group of models.
Every placement explicitly selects a variant, so rebuilds never reshuffle scenery. The initial library contains five
four-model palettes: `radiant-underbrush`, `river-wetland`, `rock-scatter`, `natural-cliffs`, and `dire-debris`.
Palette models are deliberately non-solid visual dressing: gameplay blocking still comes from terrain, checked solids,
or dedicated tree/blocker entities. `map_preview` projects the installed, CRC-matched Valve MDAT render bounds through
each prop's pitch/yaw/roll and uniform/non-uniform scale, giving accurate top-down placement context without claiming
collision. A loose or packed addon override at the same model path suppresses the base-game outline instead of borrowing
the wrong bounds. `npm run test:palette-bounds` re-extracts all 20 installed bounds with ValveResourceFormat and fails if a
snapshot is stale. Catalog checks and the repository compiler fixture prove availability and Source 2 compatibility,
but a human must still judge appearance and final placement. Use `palette_preview`
`{ "palette": "river-wetland" }` to inspect one exact four-model set as textured, rotatable 3D without Dota or Hammer.
It is local-only by default; add `"share": true` only when a temporary public review link is wanted.
`animatedPropSet` is a deliberately narrow first dynamic-scenery recipe. It accepts only the CRC-fingerprinted
`radiant-team-banner` and `dire-team-banner` models and only the two looping sequences actually read from each installed
Valve ANIM block. It emits `prop_dynamic` entities with `solid=0`, nav-ignore, `CreateNavObstacle=0`, animgraphs disabled,
and `AnimateOnServer=0`; collision, arbitrary model paths, arbitrary sequence names, and server-side animation are not
accepted. Named placements retain the same checked transforms and bounded scale as static sets and may desynchronize
their loop cycle. `animated_prop_preview` exports exactly one requested loop per GLB and autoplays each card outside the
engine. The repository fixture proves all four generated entities through Valve conversion and compilation. Real Dota
runs then proved that both checked banner models play their exact checked sequence and advance their animation cycle on
the client-safe prop, with an isolated server-animated control agreeing. A strict cloth-pixel attribution run remains
pending one explicitly approved launch; the automation deliberately rejected broad scene-motion false positives.
The `arch` component is a checked rectangular opening assembled from two solid posts and one elevated lintel. Its
origin is the center of the arch at ground level; width, depth, total height, opening width, opening height, yaw, and
one preflighted visible material are explicit. Offline reachability uses a conservative 256-unit standing corridor,
so the posts block their true footprints while a sufficiently high lintel leaves the doorway open. This is a safe
reusable composition, not a general-purpose hole or arbitrary mesh API.
`profileArch` keeps the same safe composition model but accepts a bounded left-to-right local `[x,z]` profile for
the opening's underside. It creates two full-height side posts and one checked per-corner-sloped overhead extrusion
between each pair of profile points. This supports asymmetric, pointed, and piecewise-curved graybox openings while
guaranteeing positive post width, increasing profile X, opening clearance, and overhead thickness. Adjacent pieces
share exact seams; no user-authored faces or triangle soup are accepted. Offline reachability respects the real sloped
underside, and Valve's converter/compiler accept the five-point, four-segment fixture.
The `bridge` component pairs one visible, checked solid deck with a same-shape `managedNavSurface` made from Valve's
dedicated `materials/editor/dota_nav_walkable.vmat` recipe. The MCP checks and mirrors both pieces together, detects
drift, previews the deck, and conservatively reports terrain clearance underneath it. `bridgeApproach` takes two
world-space top-surface endpoints and derives a correctly sloped visible ramp plus its exact navigation twin, so a
three-piece crossing does not need hand-calculated corner heights. Valve's converter and compiler accept the visible
composition. A separate isolated Dota fixture moved all tile terrain 46,341 units away and proved that the three
navigation surfaces alone create the bridge route while a nearby no-surface control remains non-traversable. Dota's
GridNav is still X/Y-only: two probes at the same X/Y but different heights alias to a zero-length route, so the MCP
does not claim independent stacked bridge and underpass routes at the same coordinates.
`ringPlatform` creates a regular three- to 32-sided walkable ring from checked convex deck/navigation pairs. Its
outer and inner values are explicit vertex radii; the center, yaw, height, segment count, and visible material are
validated. The composition leaves a real central opening without allowing raw mesh input. Valve's
compiler accepted the complete visible eight-segment ring. In a separate terrain-free engine fixture, Dota connected
an arc across four wedge seams while both the center hole and the surrounding void remained non-traversable.
`holedPlatform` generalizes that composition to irregular outer and hole outlines. Equal point counts define explicit
seam pairs. When the counts differ, the MCP deterministically subdivides existing boundary edges at their combined
normalized-perimeter positions; this preserves every supplied vertex and both exact outlines while producing paired
seams. Both loops must use the same winding and point zero is the correspondence anchor. The validator proves each
outline is simple, keeps the hole strictly inside, rejects crossing boundaries or spokes, and verifies that the
generated segments partition the platform without gaps or overlaps after output rounding. It then emits only ordinary
checked solid/navigation pairs, not a user-authored triangle mesh. Valve's converter and ResourceCompiler accept the
unequal five-outer/four-hole fixture after its boundaries are safely expanded to eight segments.
`multiHoledPlatform` accepts one simple outer outline plus two to eight independent simple holes (128 total points).
The pinned Earcut library proposes a triangle partition, but its output is never trusted directly: the MCP independently
proves every directed boundary edge, two-sided internal seam, expected triangle count, connectedness, absence of
crossings/overlaps/T-junctions, and exact usable area. A valid result becomes matched checked solid/navigation triangle
pairs; a valid-looking input whose candidate is nonconforming is rejected rather than approximated. Offline
reachability preserves each opening, and Valve's converter/compiler accepts the two-hole, 14-triangle fixture.
These recipes can also live inside a named specification `component`. One local objective kit can therefore combine,
for example, a camp, boss pit, fog blockers, bridge approach, and ring platform, then be placed or mirrored repeatedly
with separate world/tile offsets. The MCP expands the recipes first and applies one namespacing/transform pass to all
generated entities, terrain, solids, navigation surfaces, volumes, and their internal references. A complete Radiant
base kit can likewise be mirrored and explicitly team-swapped into its Dire counterpart without maintaining two
nearly identical definitions. Components can nest those kits, so a complete base can be assembled from a structure
core, terrain platform, walls, and objective pieces while retaining one checked placement interface.

## Learn from other custom games

Find, fetch and dissect any published custom game — the same Steam UGC backend the client uses,
driven from outside the game:

- **`workshop_search`** — search by name (e.g. `"tower defense"`) → ids, titles, subscriber counts.
- **`workshop_download`** — download by id via SteamCMD (anonymous; auto-installs SteamCMD on first
  use). No Steam login needed for Dota custom games. By default it then **extracts the code and
  decompiles the compiled Panorama** into the reference library so it's instantly browsable/searchable
  (`extract:false` to skip).
- **`workshop_grep`** — full-text **search the code across all downloaded/subscribed games** straight
  from their VPKs (lua/KV/panorama, compiled panorama decompiled on the fly) — scope to one `id` or
  search everything; filter by `ext` to go faster.
- **`workshop_list` / `workshop_inspect` / `workshop_read`** — list local items (subscribed +
  downloaded) and read any file straight out of their VPK to study how they're built. Published games ship
  Panorama **compiled** (`.vcss_c`/`.vjs_c`/`.vxml_c`); `workshop_read` (and `vpk_read`) **auto-decompile** these
  back to CSS/JS/XML source so you can study real shipping UI, animations and HUDs.
- **Reference library** (`ref_harvest` / `ref_search` / …) — collect games into a persistent, quality-scored,
  topic-classified local code library (including decompiled Panorama UI) and search across all of it on demand.
- **`asset_db`** — a SQLite index of **every file across all unpacked games**, so finding any
  model/particle/sound/texture by **kind/extension/name** is a fast structured query instead of a scan.
  `action=search` (default) / `stats` / `rebuild`; auto-updates on download/unpack. e.g.
  `asset_db query="tower" kind="model"`.

So you can go from *"how does a popular TD spawn waves?"* to reading its actual `waves.lua` in a couple
of calls.

### Preview assets without launching Dota

Eyeball particles, textures, models and sounds straight from the downloaded games — decoded
out-of-engine via [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)
(auto-installs on first use, Windows). Both tools return an **inline image in chat** (a numbered
contact sheet), so previews are viewable **over remote-access** where opening a browser isn't possible,
*and* write a self-contained HTML page for richer local viewing.

Powered by [Source 2 Viewer](https://s2v.app) ([ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)).

- **`asset_preview`** — find matching particles (`.vpcf`), textures (`.vtex`) or models (`.vmdl`),
  decode them (textures → PNG, models → GLB, particles → their sprite texture), and return a numbered
  contact-sheet image inline + an HTML gallery with interactive 3D `<model-viewer>` for models. e.g.
  `asset_preview query="spark" kind="particle"`.
- **`sound_preview`** — find matching sounds (`.vsnd`), decode them, and return an inline image (a real
  amplitude waveform for the rare PCM sound; a labelled speaker tile + accurate duration for MP3, the
  usual Dota codec — MP3 can't be waveformed out-of-engine) + an HTML **soundboard** with a real
  `<audio>` player per sound; small sounds are also embedded inline as playable audio. e.g.
  `sound_preview query="explosion"`.
- **`preview_studio`** — build a rich **interactive** gallery and expose it on a **public share link**
  (Cloudflare quick tunnel) you open in any browser, including a phone over remote-access. Particles are
  replayed live as animated additive billboards from their real `.vpcf` parameters (move + glow); models
  are interactive 3D (rotate); sounds get a player. Every card has a stable **ID** (P#/M#/S#/T#) and a
  **«выбрать» button**: pick by clicking (the click posts to the gallery server) or by telling the agent
  the ID. `preview_selections` returns what was clicked, `preview_pick id="M3,P7"` resolves explicit IDs —
  both map the choice back to the source game + asset path. `preview_studio_stop` tears it down.

## Built-in references (offline)

No need to leave the editor to look things up:

- **`lua_api_search` / `lua_api_get`** — the VScript (Lua) server API.
- **`panorama_api_search` / `panorama_api_get`** — the Panorama JS API. Globals resolve to their
  interface: `panorama_api_get $`, `panorama_api_get GameEvents`, `panorama_api_get Players.GetLocalPlayer`.
- **`docs_search` / `docs_get` / `docs_list`** — the ModDota guides. Browse with `docs_list`, search
  with `docs_search modifier`, read with `docs_get abilities/ability-keyvalues`.
- **`tools_catalog`** — the curated list of tools/libraries/references (filter by category or query).

## Building maps

`.vmap` files are DMX documents. The MCP edits them as text via Valve's `dmxconvert.exe`
(binary ↔ keyvalues2), then compiles with `resourcecompiler` (`-game <dota>/game/dota`) into a
playable `.vpk` — a pipeline verified end to end.

- **`map_create`** — clone the official template map (ground + lighting + team spawns) into your
  addon and register it in `addoninfo.txt`. Pass `compile: true` to produce the `.vpk` immediately.
- **`map_add_entity`** — place any entity (`info_player_start_*`, `npc_dota_spawner`, `env_*`,
  `prop_dynamic`, `point_*`, …) with origin/angles/scales/properties.
- **`map_inspect`** — return compact structured map data without launching Dota: filterable named
  entities, class counts, complete path-chain summaries, tile-grid bounds/height/water/tilesets, and
  broken-link or out-of-bounds findings. Use `includePathNodes:true` only when individual waypoints
  are needed. By default it also samples every path against the tile grid and flags terrain-boundary
  exits, water crossings, and abrupt height-level changes. This is a fast structural heuristic;
  final Valve navmesh behavior still needs compilation or an in-game self-test.
- **`map_patch_entities`** — batch-convert named layout markers into real gameplay entities and
  update their class, name, transform, and keyvalues without disturbing unrelated map data.
- **`map_sync_contract`** — preview or apply the same desired-state map specification accepted by
  `map_build`, conventionally stored in `.dota-workshop/map-contract.json`. It creates missing named entities, expands
  complete linked waypoint chains, repairs drifted class/position/rotation/keyvalues, prunes obsolete
  numbered nodes owned by those paths, creates or repairs checked solid volumes, expands reusable regions/components/placements, preserves unrelated map data, and refuses ambiguous duplicate
  target names. Its preview includes the same whole-map material/model resolution and explicit managed-PHYS proof as
  `map_build`; applying is blocked when an asset or requested collision hull cannot be safely resolved. Preview is the
  default; pass `apply:true` to write and `recompile:true` to compile.
  Applied map changes use a transaction: the current source map (and compiled map when relevant) is
  backed up under `.dota-workshop/backups`, conversion is staged before replacement, and a failed
  conversion or compile restores the prior files automatically. `map_build` and `map_terrain` use the
  same safety layer.
- **`map_rewrite_path`** — convert/rename a complete numbered waypoint chain while repairing all
  target links (for example generated `path_track` routes → creep `path_corner` routes).
- **`map_to_text` / `map_from_text`** — read/write the full vmap DMX text for arbitrary edits.
- **`map_compile`** — resolve all VMAP materials/models and any explicit managed-PHYS promises first, then compile
  `.vmap` → `.vpk`; missing, unsafe, or unproven assets stop before the expensive Valve compiler run. `dryRun:true`
  returns both the command and evidence.
- **`map_list`** — list maps with source/compiled status.
- **`map_validate`** — no-game preflight: verify map registration, source/compiled state, required
  script-facing entities, duplicate target names, and broken `path_corner`/`path_track` chains. It
  reports when the compiled VPK is older than the VMAP source; `requireCompiled:true` makes a missing
  or stale build an error. It automatically loads `.dota-workshop/map-contract.json` when the project
  provides one. Known property types are checked through inherited definitions from Valve's installed
  `base.fgd` and `dota.fgd`. Unknown custom metadata remains informational by default; pass
  `strictEntityProperties:true` to turn unknown classes/properties into warnings. Declared dropdown choices and
  numeric bounds are enforced; a named destination that cannot be resolved is reported as a warning. Dynamic
  targets such as `!activator`, wildcard targets, and existing class-name destinations are not misreported. The same
  preflight resolves every material and model serialized in the VMAP against addon/base loose source, compiled assets,
  and addon/Dota/core VPKs. It also proves every explicit managed `modelPhysics: "required"` promise from real decoded
  Valve PHYS data. Missing, unsafe, or unproven resources are errors; source-only custom assets are warnings until
  compiled, or errors when `requireCompiled:true`. It also verifies both `dota_minimap_boundary` corners, overview KeyValues, source and compiled material/texture
  assets, PNG dimensions, and the exact world/image/display transform. Valve's legacy `rotate` field is validated as
  an integer flag: `0` is north-up and any nonzero value is one clockwise 90-degree display turn. Rotated source
  images must be square, matching Valve's client requirement.
- **`map_engine_nav_test`** — optional engine preflight for facts the text pipeline cannot prove.
  Call it once with `dryRun:true` to review route/check counts, then with `dryRun:false` when Dota is
  closed, or attach to a normally launched Workshop Tools session. The tool runs correlated, console-safe chunks of
  `GridNav:CanFindPath`, `GridNav:FindPathLength`, and `GridNav:IsTraversable`, then reassembles each logical route.
  A blocked point also receives a bounded nearest-reachable suggestion when Dota can find one; adjacent segment
  reports for the same point are collapsed into one actionable repair rather than repeated warnings.
  DebugSDK 1.3.0 also repairs the subtler case where both endpoints are individually traversable but a wall,
  obstruction, or isolated region prevents any path between them.
  The guarded launch waits for Dota's real render window, handles the exact watchdog stall popup, and sends one
  explicit custom-map load command when the command-line launch remains on the dashboard. Tool-owned sessions are
  still shut down automatically in success and failure cases.

For a project-independent real-engine acceptance check, run `npm run test:engine-nav-fixture` while Dota is
closed. The opt-in runner creates a uniquely named disposable addon from Valve's locally installed blank-map
structure, compiles it, launches one guarded Steam session, and asserts both a known-open route and a deliberately
disconnected route with an exact engine-proven repair suggestion. It always closes its own Dota session and removes
both temporary addon trees. Nothing from Valve's blank VMAP is copied into this repository.

The bridge-specific proof is `npm run test:compiler-bridge-nav-fixture` for conversion/compilation only, or
`npm run test:engine-bridge-nav-fixture` for one guarded Dota launch. It relocates Valve's tile terrain far away,
omits visible bridge solids so they cannot generate navigation accidentally, and leaves only two sloped approaches
plus one flat `dota_nav_walkable` deck at the probe site. The engine test requires the bridge route to pass, a nearby
route with no surface to fail, and the same-X/Y/different-Z probe to demonstrate GridNav's two-dimensional alias.
The runner shuts down Dota and removes both disposable addon trees in success and failure cases.

The matching ring proof is `npm run test:compiler-ring-nav-fixture` or `npm run test:engine-ring-nav-fixture`. It
leaves only eight regular `dota_nav_walkable` wedges at the probe site. The engine run must cross four seams around
the ring, reject a route beginning in the center opening, and reject a route beginning outside the outer edge. Like
the bridge fixture, it refuses to replace an existing Dota session and cleans up its own addon automatically.

For a real project, run `npm run test:engine-nav-map -- "C:\path\to\project" map_name` first. That command is a
dry run by default. Add `--apply` only after reviewing the plan; `--no-compile` and `--no-attach` reuse an already
compiled map and installed DebugSDK, and `--endpoints` or `--segments` narrows the checks. The runner saves the full
structured result as `artifacts/mcp-engine-nav-map_name-latest.json` in the project and always asks the MCP tool to
shut down a Dota session it launched. It refuses to replace an existing Dota session unless
`--replace-running-dota` is explicitly supplied.

The companion `npm run test:engine-visual-map -- "C:\path\to\project" map_name` command is also dry-run-first.
Add `--apply` for the guarded minimap/camera check. Structured measurement is the default; add `--screenshots` only
when visual frames are needed. Blank or nearly uniform GPU captures are rejected instead of being attached as evidence.

For one named checked animation, run
`npm run test:engine-animation-map -- "C:\path\to\project" map_name target_name --frame=1600,90,60,530`.
It only writes a dry-run report by default. Add `--apply` for one guarded engine session and add `--pixel=warm` only
when the target has the checked warm-colour profile. Reports are saved under the project's `artifacts` directory;
`--attach-frames` saves the two PNGs when pixel proof is requested. Existing Dota sessions are preserved unless
`--replace-running-dota` is explicitly supplied.

If engine startup is uncertain, run `map_engine_readiness_probe` before `map_engine_nav_test`; unlike the
navigation test, the readiness probe sends no gameplay command and returns a screenshot plus structured
console/window evidence explaining where startup stopped. Both tools accept `attachToRunningDota:true` for a
map already loaded through the normal Workshop Tools UI. Set `compile:false`; the attached session is preserved.

Contract entries under `requiredEntities` are validation-only. Entries under `managedEntities`
are declarative desired state and require `targetname`, `classname`, and `origin`; `angles` and
`properties` / `removeProperties` are optional. `managedAbsentEntities` removes exact template
leftovers by `classname` plus `targetname` or `origin`; ambiguous matches are refused and validation
reports any selector that still matches. A `managedPaths` entry takes a `name` plus
`points: [[x,y,z], ...]` and expands to `name_1`, `name_2`, and so on with generated `target` links;
the terminal node explicitly removes stale `target` values (`startIndex`, `classname`, `loop`,
`angles`, and shared `properties` are optional). `maxSegmentLength` rejects accidental large jumps;
`mirrorOf` plus `mirrorAxis` (`x`, `y`, or `xy`) enforces exact route symmetry. `map_validate`
checks all expanded entities. `spatialAssertions` turns important layout intent into continuous data checks:
`entityDistance` enforces a planar minimum and/or maximum between two managed entities (including generated path
nodes), `entityPathDistance` measures one managed entity against the closest point anywhere on a complete route, and
`pathSeparation` measures the true closest points along two complete managed polylines rather than only comparing
waypoints. Assertions are named, reference-checked, component-aware, and namespaced through reusable
placements. Build/sync refuses a violated assertion; validation reports the measured distance without writing.
`map_preview` draws each measurement between its deterministic closest world points: bright green means the rule passes,
red means it fails, and a red X identifies a zero-distance crossing. The same witness coordinates and measurements are
returned as structured data, so automation and humans inspect the identical result.
`managedTerrain` is an ordered list of the same idempotent tile-grid
operations accepted by `map_terrain`: `fill`, `height`, `water`, `tileset`, and `ramp`, using `rect`,
`circle`, `ring`, `path`, `polygon`, reusable `region`, or `managedPath` shapes in tile coordinates. Contract sync previews exact height-vertex,
water-vertex, and tileset-cell drift before writing; undeclared terrain remains untouched unless the
contract explicitly uses `fill`. A terrain shape can also use
`{"kind":"managedPath","name":"path_name","width":2}` to derive its tile-space stroke from an
existing managed world-space path, keeping roads synchronized with route edits.

`managedSolids` adds named, always-solid `func_brush` world geometry. Each solid supplies `center`, optional `yaw`,
an explicit visible (non-`materials/tools`) `materials/...vmat` side/fallback asset, and an `extrusion`. An optional
`faceMaterials` object may override the `top`, `bottom`, or both while all side faces retain `material`; the same option
is available on `arch`, `profileArch`, `bridge`, `bridgeApproach`, `ringPlatform`, `holedPlatform`, and
`multiHoledPlatform`. `faceTextureScales` similarly accepts checked `[u, v]` pairs for `top`, `bottom`, and/or `sides`.
Values must be finite and non-zero within +/-4096; negative values intentionally mirror that texture axis. The MCP
also accepts `faceTextureShifts` in the same three roles, with finite U/V offsets within +/-32768. It preserves the
generated projection directions while replacing only their shift values. `faceTextureRotations` rotates those owned
axes from -180 through 180 degrees around each outward face normal; it does not accept caller-authored vectors. The MCP
also accepts `faceTextureAlignments` with the value `"shared"` for any role. Shared alignment derives a canonical
object-local planar basis from each face normal, giving coplanar top/bottom triangles the same projection and matching
the two triangles of each side panel. The MCP assigns all of these settings by generated face role, so callers never
provide raw face indexes, axis vectors, or arbitrary triangles. Use
`{ points: [[x,y],...], height }` for a flat centered extrusion, or provide one local height per outline corner with
`{ points, bottom: [z,...], top: [z,...] }` for a sloped one. Every top height must remain above its matching bottom.
The footprint may be convex
or concave, but it must be one simple closed outline: duplicate points, collinear adjacent edges, crossings, touching
non-adjacent edges, out-of-range coordinates, unsafe material paths, and reserved brush-property overrides are rejected.
The MCP normalizes winding (while retaining height-to-corner pairing), triangulates the top and bottom deterministically,
closes every side, and then proves every
half-edge has exactly one opposite before writing the VMAP. Solids reconcile by targetname, mirror inside reusable
components, appear in `map_preview` with an uphill arrow when sloped, and block their true concave footprint in offline
reachability when their vertical range intersects the standing corridor. The repository fixture round-trips flat and
sloped L-shaped solids, a checked three-piece rectangular arch, a six-piece profile arch, a visible bridge deck, a complete sloped bridge approach, an
eight-segment ring platform, an eight-segment unequal-outline holed platform, and a 14-triangle two-hole platform,
each paired where appropriate with Valve navigation geometry. Its profile arch also proves distinct top, bottom, and
side materials survive Valve's converter and compile into a real VPK. The general map material preflight proves every selected visible material exists before a build,
sync, or compile is allowed to spend work on it.

`managedNavSurfaces` adds named, checked Source 2 meshes using Valve's dedicated navigation-walkable material. Its
`center`, optional `yaw`, and flat or per-corner-sloped `extrusion` use the same validated polygon and watertight
half-edge writer as `managedSolids`, but the result is grouped as navigation metadata rather than a visible
`func_brush`. Surfaces reconcile by name, transform inside reusable components, appear in `map_preview`, and include a
conservative underpass-clearance report against every overlapping terrain cell. The report deliberately labels each
project's deck connectivity as engine-required; the isolated repository fixture proves the generated material and
flat/sloped geometry work in real GridNav, while `map_engine_nav_test` proves a particular compiled map's routes.

`managedVolumes` adds named convex gameplay solids in world coordinates. A volume chooses `size: [x,y,z]` for a box,
`polygon: { points: [[x,y],...], height }` for a flat three- to 64-sided prism, or
`polygon: { points: [[x,y],...], bottom: [z,...], top: [z,...] }` for a sloped one. Sloped volumes provide one local
bottom and top height per footprint point; both rings must be coplanar, and every top corner must remain above its
matching bottom corner. `center` and optional `yaw` place the shape in the map. Polygon points must be unique, strictly
convex, non-collinear, and non-self-intersecting. Each
volume uses one checked Valve-derived recipe: `camp`, `trigger`, `heroTrigger`, `dotaTrigger`, `bossAttackable`,
`noWards`, or `playerClip`. The recipe controls the entity class and tool material; contracts cannot override reserved
class, transform, or brush fields. Preview, drift validation, reusable component mirroring, and offline `playerClip`
reachability all follow the true polygon footprint rather than its bounding box, and preview arrows show the uphill
direction of sloped volumes. Flat and sloped polygons are exercised by both Valve's `dmxconvert` round trip and an
opt-in isolated `resourcecompiler` integration test. Arbitrary solid classes, concave footprints, twisted/non-coplanar
faces, and curved geometry are deliberately rejected.

Map registration supports both legacy KeyValues 1 and the KV3 `addoninfo.txt` produced by current
Workshop Tools. Source-controlled layouts under `game/dota_addons/<addon>` and
`content/dota_addons/<addon>` are detected directly. `addon_link dryRun=true` previews safe junctions;
the real link operation refuses to overwrite conflicting folders.

Then launch it: `addon_launch_custom_game map="<name>"`.

> Limitation: the MCP can safely generate checked flat or per-corner-sloped extrusions with convex or concave outlines,
> flat/sloped convex gameplay volumes, rectangular and profile-driven arches assembled from checked solids, and checked bridge
> decks/approaches, regular ring platforms, and irregular single- or multiple-hole platforms paired with Valve navigation-walkable
> geometry. Multi-hole candidates must pass strict conforming-partition proofs and may safely reject otherwise valid
> layouts. Freeform 3D meshes, truly curved surfaces, terrain props, and decorative cliff
> brushwork still require Hammer or
> a future checked recipe. Because Valve GridNav aliases height at a shared X/Y location, independent stacked bridge
> and underpass navigation is not represented by this API.

## Notes & limitations

- `kv_read` returns the file's own wrapper block and lists `#base` includes, but does not yet inline
  `#base` files — read those directly via `path`.
- Editing an entry with `kv_upsert_entry` preserves comments on *other* entries; the edited entry is
  regenerated from your JSON.
- Heroes can only be created by overriding an existing hero (`scaffold_hero` writes an `override_hero`
  block) — this is a Dota engine constraint.

## Development

```bash
npm run dev    # run the server from source via tsx
npm test       # offline unit + integration tests (engine/compiler proofs stay opt-in)
npm run smoke  # boot the server over stdio and exercise the tools end-to-end
npm run test:compiler-fixture # with Workshop Tools: convert + compile the generated legal fixture, then clean up
```

## License

MIT — see [LICENSE](LICENSE).
