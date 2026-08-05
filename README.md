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

> Status: working — **118 tools**, end-to-end tested. It can search the Workshop for custom games by
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
| **Maps** | `map_create`, `map_add_entity`, `map_inspect`, `map_patch_entities`, `map_sync_contract`, `map_rewrite_path`, `map_to_text`, `map_from_text`, `map_compile`, `map_list`, `map_validate`, `map_engine_readiness_probe`, `map_engine_nav_test` |
| **Map generation** | `map_build`, `map_terrain`, `map_preview`, `map_tile_to_world`, `map_recipe_catalog`, `entity_catalog`, `scaffold_td` |
| **Reference games** | `workshop_search`, `workshop_download`, `workshop_list`, `workshop_inspect`, `workshop_read`, `workshop_grep`, `panorama_decompile` |
| **Asset preview (out of engine)** | `asset_preview` (particles/textures/models → inline contact-sheet image + HTML gallery), `sound_preview` (sounds → inline waveform/icon image + playable HTML soundboard + inline audio), `preview_studio` / `preview_studio_stop` (interactive gallery + public share link: animated particles, 3D models, audio players, click-to-select), `preview_pick` / `preview_selections` (resolve the IDs the user picked/clicked → game + asset path) — decoded via ValveResourceFormat, no Dota launch |
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
  invokes Dota's `jpeg` command, but is not used automatically because that engine path can crash some Workshop sessions.
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

The SDK also exposes `mcp_spawn`, `mcp_gold`, `mcp_level`, `mcp_item`, `mcp_event` (fire a custom UI event), `mcp_hud`
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
  `managedTerrain` / `managedEntities` / `managedPaths` / `managedVolumes` vocabulary as `map_sync_contract`. A specification can
  also define reusable named `regions`, reusable `components`, and transformed `placements`; one component may
  contain local entities, paths, terrain, and checked solid volumes, and every placement is automatically namespaced. Legacy
  `terrain` / `entities` / `paths` inputs remain compatible. See
  [`examples/map-specification.json`](examples/map-specification.json) for a complete starter. Pass
  `dryRun:true` to generate and report the plan without writing, registering, or compiling anything.
- **`map_terrain`** — apply the shared validated terrain vocabulary to an existing map. It supports
  `fill` / `height` / `water` / `tileset` / `ramp` over `rect` / `circle` / `ring` / `path` /
  `polygon` / reusable `region` / `managedPath` shapes and regenerates valid cliff orientation and tile recipes. It is
  preview-only by default; pass `apply:true` after reviewing the exact change counts.
- **`map_preview`** — render a diagnostic top-down **image straight from the data**, no game launch.
  In addition to shaded terrain and water it overlays contours, cliff cells, ramp cells, current arrows,
  entities, complete waypoint paths, tower ranges, camps, objectives, minimap bounds, checked trigger/blocker volumes, missing terrain
  recipes, cyan bounds recovered from real model `PHYS` blocks, explicit Valve tree/obstruction broad phases,
  collision-enabled props whose physical bounds remain unknown,
  and regions unreachable from player/creep spawns. Every overlay family can be hidden.
- **`map_reachability`** — analyze the whole tile grid offline and report missing terrain recipes,
  cliff-separated regions, trapped spawns, blocked entrances, inaccessible objectives or camps, and
  waypoint segments that cross blocked cells. It recognizes generated ramps and checked player-blocking
  volume footprints, treats Dota river water as walkable, and resolves collision-enabled props through
  ValveResourceFormat, preferring loose compiled models and the active addon's `pak01_dir.vpk` before the base Dota
  archive. Only conservative bounds from a real non-empty model `PHYS` block are cached, transformed,
  previewed, and allowed to block covered cells; render/hitbox bounds are never substituted. It also warns when a
  waypoint approaches `ent_dota_tree` or `point_simple_obstruction`, using a deliberately small 64-unit broad phase
  because Valve does not publish those exact hulls in FGD. Exact hull surfaces, pitched/rolled transforms, dynamic
  collision, and Valve's final navmesh remain engine-test responsibilities. Set `resolveModelCollision:false` for a
  faster terrain-only pass.
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
- **`map_recipe_catalog`** — inspect the named terrain cores, Radiant/Dire cliff recipes, ramp-safe
  fallbacks, checked solid-volume recipes, and official Valve prefab references used by the generator. `verifyInstalled:true` checks
  the references against the current Workshop Tools install without opening Hammer. It also compares Steam/Dota/tools
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

For common gameplay structure, `dotaComponents` provides strongly checked `base`, `ancient`, `tower`, `fountain`,
`shop`, `camp`, `bossPit`, `playerStart`, `gate`, `baseBlocker`, and `fowBlocker` entries. It derives team numbers, official entity classes,
stock unit/model names, tower tier names, shop/camp numeric values, base member transforms, and boss-pit terrain.
See [`examples/dota-components.json`](examples/dota-components.json). A `camp` can include an optional checked
rectangular `volume`, which creates the real `trigger_multiple` bounds referenced by its spawner. A boss pit's
`noWardsRadius` creates a real `trigger_no_wards` prism using a checked, configurable regular-polygon approximation
(32 sides and 1024 units tall by default). The polygon is circumscribed, so the requested radius is fully covered;
at 32 sides the maximum radial overshoot is under 0.5%.
`baseBlocker` uses Valve's team-aware base-gate entity. `fowBlocker` turns two or more points into uniquely named,
explicitly linked `ent_fow_blocker_node` lines; broken links are reported by map inspection/validation and drawn in previews.

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
  `prop_dynamic`, `point_*`, …) with origin/angles/properties.
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
  target names. Preview is the default; pass `apply:true` to write and `recompile:true` to compile.
  Applied map changes use a transaction: the current source map (and compiled map when relevant) is
  backed up under `.dota-workshop/backups`, conversion is staged before replacement, and a failed
  conversion or compile restores the prior files automatically. `map_build` and `map_terrain` use the
  same safety layer.
- **`map_rewrite_path`** — convert/rename a complete numbered waypoint chain while repairing all
  target links (for example generated `path_track` routes → creep `path_corner` routes).
- **`map_to_text` / `map_from_text`** — read/write the full vmap DMX text for arbitrary edits.
- **`map_compile`** — compile a map's `.vmap` → `.vpk`.
- **`map_list`** — list maps with source/compiled status.
- **`map_validate`** — no-game preflight: verify map registration, source/compiled state, required
  script-facing entities, duplicate target names, and broken `path_corner`/`path_track` chains. It
  reports when the compiled VPK is older than the VMAP source; `requireCompiled:true` makes a missing
  or stale build an error. It automatically loads `.dota-workshop/map-contract.json` when the project
  provides one. Known property types are checked through inherited definitions from Valve's installed
  `base.fgd` and `dota.fgd`. Unknown custom metadata remains informational by default; pass
  `strictEntityProperties:true` to turn unknown classes/properties into warnings. Declared dropdown choices and
  numeric bounds are enforced; a named destination that cannot be resolved is reported as a warning. Dynamic
  targets such as `!activator`, wildcard targets, and existing class-name destinations are not misreported.
- **`map_engine_nav_test`** — optional engine preflight for facts the text pipeline cannot prove.
  Call it once with `dryRun:true` to review route/check counts, then with `dryRun:false` when Dota is
  closed, or attach to a normally launched Workshop Tools session. The tool runs correlated, console-safe chunks of
  `GridNav:CanFindPath`, `GridNav:FindPathLength`, and `GridNav:IsTraversable`, then reassembles each logical route.

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
checks all expanded entities. `managedTerrain` is an ordered list of the same idempotent tile-grid
operations accepted by `map_terrain`: `fill`, `height`, `water`, `tileset`, and `ramp`, using `rect`,
`circle`, `ring`, `path`, `polygon`, reusable `region`, or `managedPath` shapes in tile coordinates. Contract sync previews exact height-vertex,
water-vertex, and tileset-cell drift before writing; undeclared terrain remains untouched unless the
contract explicitly uses `fill`. A terrain shape can also use
`{"kind":"managedPath","name":"path_name","width":2}` to derive its tile-space stroke from an
existing managed world-space path, keeping roads synchronized with route edits.

`managedVolumes` adds named convex prisms in world coordinates. A volume chooses either `size: [x,y,z]` for a box or
`polygon: { points: [[x,y],...], height }` for a three- to 64-sided local footprint; `center` and optional `yaw` place
that shape in the map. Polygon points must be unique, strictly convex, non-collinear, and non-self-intersecting. Each
volume uses one checked Valve-derived recipe: `camp`, `trigger`, `heroTrigger`, `dotaTrigger`, `bossAttackable`,
`noWards`, or `playerClip`. The recipe controls the entity class and tool material; contracts cannot override reserved
class, transform, or brush fields. Preview, drift validation, reusable component mirroring, and offline `playerClip`
reachability all follow the true polygon footprint rather than its bounding box. Generated polygons are exercised by
both Valve's `dmxconvert` round trip and an opt-in isolated `resourcecompiler` integration test. Arbitrary solid classes,
concave footprints, sloped faces, and curved geometry are deliberately rejected.

Map registration supports both legacy KeyValues 1 and the KV3 `addoninfo.txt` produced by current
Workshop Tools. Source-controlled layouts under `game/dota_addons/<addon>` and
`content/dota_addons/<addon>` are detected directly. `addon_link dryRun=true` previews safe junctions;
the real link operation refuses to overwrite conflicting folders.

Then launch it: `addon_launch_custom_game map="<name>"`.

> Limitation: the MCP can safely generate checked box and convex-prism gameplay volumes, but general-purpose
> **polygon-mesh geometry** is still authored in **Hammer**. It does not sculpt concave/sloped/curved solids, bridges,
> terrain props, or decorative cliff brushwork.

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
