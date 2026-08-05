# Automation improvement progress

Last updated: 2026-08-05

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
20. `00c3849` - completed static Rubikon PHYS-family decoding. Version-3 cache entries apply per-part 3x4 bind
    poses, preserve exact convex hulls, build conservative mesh-vertex envelopes, derive posed sphere/capsule bounds,
    reject undecodable posed shapes, and report each projection class in preview and reachability output.
21. `4a64271` - added an evidence-gated Valve recipe refresh workflow. The MCP now reports exact source comparisons,
    affected recipe families, a reviewable candidate baseline, and explicit blockers; a safe CLI runner automates build,
    tests, MCP smoke, and the isolated compiler fixture but cannot edit or auto-bless the trusted baseline.
22. `6487003` - bounded explicit Steam launches when `-applaunch` is not forwarded and added non-owning attach
    mode to readiness and GridNav tools. A user-started, VConsole-enabled Workshop Tools session can now be checked
    without compiling underneath it, relaunching Dota, or closing the user's session.
23. `8922af3` - added bounded engine-backed nearest-reachable waypoint suggestions to DebugSDK 1.2.0 and
    `map_engine_nav_test`, deduplicated adjacent segment failures into actionable repairs, corrected the 3v3 map's
    four mirrored blocked waypoints from the parent specification, rebuilt it, and proved all 64 GridNav checks pass.
24. `775d39e` - closed the launch-to-map gap. The guarded navigation runner now waits through the early
    VConsole-without-window race, safely closes only Source 2's exact watchdog stall window, focuses the render window,
    explicitly loads the requested custom map when a fresh DebugSDK response does not arrive, runs GridNav, and shuts
    Dota down. One autonomous Steam run demonstrated the entire sequence with no human UI interaction.
25. `10acf5e` - added a repository-owned, disposable real-GridNav fixture with a known-open route and a
    deliberately disconnected route. DebugSDK 1.3.0 now suggests repairs when endpoints are individually walkable
    but isolated from each other. The opt-in runner compiles, launches, asserts the exact engine-proven repair,
    reports console errors, shuts Dota down, and removes both temporary addon trees.
26. This milestone - retained decoded sphere/capsule PHYS primitive geometry through per-part bind poses and cache
    version 4, then projected it through entity transforms with 32 tangent half-planes. Preview and reachability now
    use a tight conservative curved outline instead of the primitive's much larger transformed box, while malformed
    metadata still falls back safely. An installed-VRF proof recovered all 14 capsules from Valve's current
    Juggernaut model.

## Current verification record

- TypeScript build passes.
- Default suite: 230 passed, 0 failed, and 3 opt-in compiler/installed-VRF tests skipped.
- MCP smoke suite: 199 passed, 0 failed, and 1 network-dependent Workshop search skipped.
- Installed recipe fingerprint is verified against Dota app build `24541331`, source revision `10879186`,
  Workshop-tools depot manifest `8024482296929360461`, and five authoritative source/tool hashes.
- The guided refresh runner completed all four safe checks in 33 seconds without opening Dota or Hammer. Because the
  installed fingerprint still matches, it correctly emitted `no-refresh-needed` and refused baseline recording.
- Valve's installed `dmxconvert.exe` successfully round-trips generated camp, polygonal no-ward, and player-clip
  volumes from text to binary VMAP and back during the integration suite.
- `npm run test:compiler-fixture` successfully round-tripped and compiled the repository-owned acceptance payload
  into a real VPK after its explicit navigation obstruction was added. The generated map uses Valve's installed blank template only as required hidden
  infrastructure, depends on no private 3v3 file, stores no copied Valve VMAP, and leaves no temporary addon trees.
- Installed ValveResourceFormat 19.2 recovered the physical hull bounds of
  `models/props_gameplay/cap_point001.vmdl_c` directly from `pak01_dir.vpk`; a second lookup reused the fingerprinted
  cache. The same real-resource test recovers validated exact convex-hull vertices into cache version 4.
  A second installed-resource proof recovered 14 of 14 capsule primitives from the current Juggernaut model,
  preserving each posed center pair and three radius basis vectors for tighter world projection.
  Empty-PHYS walls, barrels, trees, gates, and props remain explicitly unresolved rather than borrowing their render
  or hitbox bounds.
- VRF's public checked Juggernaut physics fixture produced 15 of 15 exact convex hulls after its 15 published bind
  poses were applied; no third-party fixture was copied into this repository.
- Real Dota 3v3 contract: 86 managed entities, 4 managed paths, 97 terrain operations, and zero desired-state drift.
- Offline 3v3 terrain: zero holes; only two known isolated regions (a tiny shelf and a deliberate off-map strip).
- Installed official definitions expose 187 enum properties with 1,171 choices, 16 explicitly ranged properties,
  and 297 named-destination fields. All 157 acceptance-map entities are recognized with zero invalid types,
  choices, ranges, or unresolved named destinations.
- Valve prefab references: 13 of 13 found in the installed Workshop Tools.
- Acceptance map compiled successfully to `three_vs_three_blockout.vpk` on 2026-08-05.
- The acceptance VMAP now contains two checked 32-sided boss no-ward prisms generated from one reusable component;
  both are contract-idempotent, visible in the diagnostic preview, and included in the fresh compiled VPK.
- Final offline acceptance: compiled map present, zero validation errors, 3,623 walkable cells,
  3,237 cells connected to the spawn network, zero terrain holes, and two known isolated-region warnings
  (a 2-cell shelf and a deliberate 384-cell off-map strip).
- Final diagnostic preview: 473 cliff cells, 127 ramp cells, 564 water cells, 86 managed entity overlays,
  60 path segments, 10 tower ranges, 18 camps, 16 objectives, 3 currents, and one minimap boundary.

## Current engine acceptance result

The attached runner now has a complete repair-and-retest proof without leaving Dota open:

- DebugSDK 1.3.0 scans a bounded eight-cell ring around blocked or disconnected route endpoints and reports the
  nearest traversable point that can reach the adjacent route anchor. The host combines duplicate endpoint/segment
  reports into one repair suggestion per affected point.
- The first 3v3 scan found one blocked mirrored waypoint on each route. A bounded symmetric comparison selected
  `(±4128, ±2784, 256)`, a roughly 101-unit correction that preserves the intended route arc.
- Contract sync changed exactly four waypoint entities and four terrain cells, retained a transactional recovery
  backup, and produced zero structural findings. Offline validation still reports zero holes and only the two known
  isolated terrain regions.
- The rebuilt map returned all four managed routes and all 64 endpoint/segment checks. Every point was traversable,
  every segment and endpoint had a valid Valve path, and the test observed zero new console errors.
- The follow-up autonomous run compiled the acceptance map, launched Workshop Tools through Steam, waited through
  11 bounded early window checks, detected that the command-line map load had not completed, issued one explicit
  `dota_launch_custom_game` command, received DebugSDK 1.2.0 at game state 4, passed all 64 checks with zero console
  errors, and shut Dota down gracefully. No UI click or human intervention was required.
- The repository-owned engine fixture then compiled and launched as a unique disposable addon. Its open route
  passed with a 768-unit path; its `point_simple_obstruction` route was correctly disconnected; and DebugSDK 1.3.0
  suggested `(-32, 480, 128)` with grid offset `(-1, +1)`. A second normal (non-probe) run returned the exact same
  result, proving the checked repair is stable. Both runs reported zero console errors, shut Dota down, and removed
  both temporary addon trees.

## Historical engine acceptance notes

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

On 2026-08-05, the NVIDIA DRS database was backed up and both predefined profiles were restored through NVIDIA's
own NVAPI. The global profile lost its one override and the Dota profile lost its one override, but a guarded direct
readiness run still produced the same `NVAPI_ACCESS_DENIED` startup modal. A distinct explicit-Steam run produced no
Dota process and no modal: the already-running Steam client did not forward `-applaunch`. Engine retries stopped there.
The MCP now fails that Steam condition after 20 seconds and supports attaching to a map launched normally through
the Workshop Tools UI. On 2026-08-05, that attached path completed both real engine stages:

- Readiness restored the hidden Dota window, received a fresh correlated DebugSDK response, and preserved the session.
- DebugSDK 1.1.3 moved GridNav logic behind a compact `mcp_nav` command, keeping every request below Source 2's console
  command limit. Request IDs prevent replayed VConsole history from satisfying a new check, and long routes are split
  into bounded overlapping chunks before their results are reassembled.
- The four managed 3v3 routes returned all 64 requested endpoint/segment checks with zero protocol failures and zero
  new console errors.
- Engine acceptance correctly failed on map data: segment 1 and segment 2 of every route are blocked because the
  mirrored waypoint at `(±4224, ±2816, 256)` is not traversable. The other 52 segment checks and all four endpoint
  checks passed. This is now an actionable map-generation issue rather than an automation gap.
