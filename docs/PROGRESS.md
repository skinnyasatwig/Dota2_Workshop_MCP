# Automation improvement progress

Last updated: 2026-08-04

## Verified milestones

1. `1110197` - unified map tools around one validated specification.
2. `5bb15e6` - added dry-run reports, transactions, backups, and rollback.
3. `3c48eff` - added diagnostic previews and offline whole-map reachability.
4. `e348177` - added reusable components, checked Dota structures, Valve terrain/prefab recipes, and official FGD validation.
5. `bdec2f0` - added guarded one-launch GridNav testing and automatic shutdown.
6. `b877b03` - added a bounded Steam-to-direct launch fallback when Steam ignores `-applaunch`.
7. `4c50e6a` - added and live-tested a dedicated one-launch readiness probe with state timeline,
   console filtering, early fatal/modal detection, dialog/process diagnosis, screenshot capture, checked
   DX11/Vulkan overrides, and mandatory shutdown.
8. `3250aa7` - added Valve-derived rectangular solid-volume authoring for camp bounds, checked triggers,
   no-ward zones, boss-attack areas, and player blockers; integrated volumes into the unified specification,
   mirroring, dry-run/sync reporting, validation, preview, reachability, reusable camps, and the recipe catalog.
9. `c0195b8` - added reusable team-aware base blockers and deterministic linked fog-of-war blocker chains,
   including preview lines, broken-link validation, base assembly support, official FGD checks, and a real
   `dmxconvert` round-trip integration test.
10. `c421796` - added checked three- to 64-sided convex-prism volume authoring, exact polygon drift detection,
    reusable-component mirroring, true-footprint preview/reachability, compiled boss-pit no-ward volumes, and
    isolated `dmxconvert` plus `resourcecompiler` integration proofs.
11. `0e63948` - added version-aware Valve recipe verification using Steam/Dota/tools build metadata and hashes
    of the official terrain tilesets, PvP prefab, FGD, and compiler; exposed verified/compatible/changed status
    through `dota_doctor` and `map_recipe_catalog`.
12. `1b4a1be` - taught the official FGD parser and validator to preserve and enforce inherited dropdown choices,
    explicit numeric bounds, and resolvable named-entity destinations; exposed these constraints through the
    entity catalog and accepted the stronger checks against the real 3v3 map.
13. `a7f8be8` - added conservative collision diagnostics: explicit Valve tree/obstruction classes receive
    warning-only route broad phases, solid props with unavailable model bounds are inventoried and drawn without
    guessed footprints, and nav-ignore/initially-disabled declarations are honored.
14. `1531961` - added cached base-game model collision inspection through ValveResourceFormat. Only bounds from
    real non-empty `PHYS` blocks are promoted; yaw/scale transforms feed cyan preview footprints, conservative
    blocked-cell analysis, and route warnings, while render/hitbox bounds and unsafe transforms remain unknown.
15. `76e608f` - added a repository-owned compiler acceptance payload and one-command opt-in test. It applies
    MCP-authored entities, paths, a base blocker, and a polygon volume to Valve's locally installed blank-map
    infrastructure, round-trips the generated VMAP, compiles a real VPK, and removes its isolated addon trees.
16. `833a598` - extended fingerprinted PHYS inspection to loose compiled addon models. Preview, reachability,
    and validation now prefer safe project-local `models/*.vmdl_c` files before the base Dota archive, reject
    traversal-like resource paths, and retain explicit unknown status when no trustworthy bounds exist.
17. `77cafc0` - added packed-addon `pak01_dir.vpk` collision lookup with Source 2 shadowing order: loose addon
    file, packed addon resource, then base Dota resource. A truly absent packed resource falls through, while a
    malformed/failed packed inspection stops safely instead of silently borrowing the wrong base model.
18. `b076a92` - replaced yaw-only PHYS projection with Valve-grounded pitch/yaw/roll transforms. Each local
    bound now transforms all eight 3D corners, records the transformed vertical extent, and exposes a conservative
    convex XY hull (including six-sided compound-angle projections); malformed or degenerate transforms stay unknown.
19. `ffa6032` - decoded VRF's validated convex `RnHull_t` vertex blobs into a versioned cache and exact top-down
    projections. Preview and reachability distinguish exact hull outlines from bounds fallbacks; out-of-bounds data,
    non-empty bind poses, PHYS meshes, and unknown layouts stay conservative rather than being labelled exact.

## Current verification record

- TypeScript build passes.
- 208 unit and integration tests pass; the opt-in compiler and installed-VRF tests are skipped during the default suite.
- MCP smoke suite: 197 passed, 0 failed, 1 skipped because the remote Steam Workshop search service was unavailable.
- Installed recipe fingerprint is verified against Dota app build `24541331`, source revision `10879186`,
  Workshop-tools depot manifest `8024482296929360461`, and five authoritative source/tool hashes.
- Valve's installed `dmxconvert.exe` successfully round-trips generated camp, polygonal no-ward, and player-clip
  volumes from text to binary VMAP and back during the integration suite.
- `npm run test:compiler-fixture` successfully round-tripped and compiled the repository-owned acceptance payload
  into a real VPK twice. The generated map uses Valve's installed blank template only as required hidden
  infrastructure, depends on no private 3v3 file, stores no copied Valve VMAP, and leaves no temporary addon trees.
- Installed ValveResourceFormat 19.2 recovered the physical hull bounds of
  `models/props_gameplay/cap_point001.vmdl_c` directly from `pak01_dir.vpk`; a second lookup reused the fingerprinted
  cache. The same real-resource test now recovers validated exact convex-hull vertices into cache version 2.
  Empty-PHYS walls, barrels, trees, gates, and props remain explicitly unresolved rather than borrowing their render
  or hitbox bounds.
- Real Dota 3v3 contract: 86 managed entities, 4 managed paths, 97 terrain operations, and zero desired-state drift.
- Offline 3v3 terrain: zero holes; only two known isolated regions (a tiny shelf and a deliberate off-map strip).
- Installed official definitions expose 187 enum properties with 1,171 choices, 16 explicitly ranged properties,
  and 297 named-destination fields. All 157 acceptance-map entities are recognized with zero invalid types,
  choices, ranges, or unresolved named destinations.
- Valve prefab references: 13 of 13 found in the installed Workshop Tools.
- Acceptance map compiled successfully to `three_vs_three_blockout.vpk` on 2026-08-04.
- The acceptance VMAP now contains two checked 32-sided boss no-ward prisms generated from one reusable component;
  both are contract-idempotent, visible in the diagnostic preview, and included in the fresh compiled VPK.
- Final offline acceptance: compiled map present, zero validation errors, 3,623 walkable cells,
  3,237 cells connected to the spawn network, zero terrain holes, and two known isolated-region warnings
  (a 2-cell shelf and a deliberate 384-cell off-map strip).
- Final diagnostic preview: 473 cliff cells, 127 ramp cells, 564 water cells, 86 managed entity overlays,
  60 path segments, 10 tower ranges, 18 camps, 16 objectives, 3 currents, and one minimap boundary.

## Engine acceptance result

The guarded runner was exercised without leaving Dota open:

- The first harness call proved the automatic shutdown path but the client itself timed out at 60 seconds.
- A corrected call showed Steam accepted but did not forward `-applaunch`; no Dota process appeared.
- The resilient launcher then used the installed executable, reached VConsole, and shut Dota down automatically.
- The addon did not reach game state 3 before the fixed deadline, so Valve `GridNav` route results remain uncollected.
- Three attempts were the stated limit. No further blind engine retries were made.

The navigation tool preserves the last DebugSDK ping, recent console output, and pre-shutdown Dota window diagnosis on readiness failures. The separate readiness-only probe gathers a full state timeline, filtered startup evidence, hidden/visible dialog diagnosis, and a screenshot without issuing gameplay or GridNav commands.

The first live readiness run found the actual pre-map blocker: Dota displayed `Unable To Start Game` with
`NVIDIA driver profile error at NVAPI_ACCESS_DENIED`. It never created a game window or loaded the addon.
The initial probe retained the complete evidence and shut Dota down. A targeted Vulkan run produced the
same NVIDIA error, proving it was not a DirectX-only failure; after early-failure detection was added, the
observer stopped in 605 ms and the entire launched process was closed in 24 seconds. No further engine
retries should occur until the user restores the Dota and global NVIDIA profiles to defaults.
