# Automation improvement progress

Last updated: 2026-08-07

## Current visual verification and wall milestone

- Added `map_engine_visual_test`, a dry-run-first, single-launch minimap verifier that discovers native HUD geometry,
  clicks normalized probes, reads the exact client camera position, optionally attaches screenshots, and performs bounded shutdown.
- DebugSDK 1.4.0 can optionally attach an invisible, idempotent Panorama camera bridge. Attach/detach preserves unrelated
  manifest entries; malformed manifests fail closed rather than being rewritten blindly.
- Added a strongly validated `wall` Dota component. Open or closed outlines become overlapping checked convex
  `playerClip` volumes, making practical curved and concave base silhouettes reusable without unsafe concave solids.
- Added dry-run-first project CLIs for both engine checks. Each writes its structured result into the tested project's
  `artifacts` directory; the navigation runner refuses to replace an existing Dota session unless explicitly permitted.
- Windows input now verifies Dota immediately before every non-sleep action and again before mouse-down. Post-click
  focus loss is distinguished from unsafe input, and camera telemetry has one bounded refocus/retry recovery.
- The final measurement-only acceptance run completed all five native minimap probes with a 63-unit error at each point,
  zero focus recoveries, and graceful shutdown. The prior failed/black screenshot is retained only as evidence that
  per-probe capture is renderer-sensitive on this machine; it is not counted as a map failure.
- Structured measurement is now the default for the project CLI. Explicit screenshot mode decodes each PNG and rejects
  black or nearly uniform frames using sampled luminance range, variance, and non-black coverage before attachment.
- The 3v3 acceptance contract moved the mirrored hard-camp pair 256 units away from a generated wall and removed a
  two-cell accidental high shelf. Offline reachability now has zero holes, zero inaccessible camps, and only the
  deliberate 384-cell off-map strip. The rebuilt map passed all four routes and all 64 Valve GridNav checks through
  the new CLI with zero console errors and graceful shutdown.
- Rotated overviews now use Valve's actual legacy convention. The installed Dota archive supplies a real
  `rotate=15` example, while Valve's published `CMapOverview` client source proves that the value is read as a
  0/nonzero flag and applies one 90-degree display turn. Offline bounds, world/display round trips, and live-click
  expectations now share that transform; non-square rotated images and fractional pseudo-angles fail closed.
- Replaced the stale Source 1 `jpeg` assumption with installed Source 2's real `png_screenshot` and
  `jpeg_screenshot` commands. Renderer capture snapshots the destination first, accepts only a brand-new stable file,
  validates its format and dimensions, rejects blank/uniform pixels, records command evidence, and never deletes or
  overwrites a pre-existing screenshot. PNG is the safe default; JPEG remains explicit-only.
- A one-probe 3v3 acceptance run produced a checked 1900x1080 Source 2 PNG, moved the camera to within 63 units of
  the expected center, needed no focus recovery, and shut Dota down gracefully. Requested screenshots now fail the
  visual run when evidence is absent, and a failed engine capture stops before another renderer request is sent.

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
26. `6a8e7ca` - retained decoded sphere/capsule PHYS primitive geometry through per-part bind poses and cache
    version 4, then projected it through entity transforms with 32 tangent half-planes. Preview and reachability now
    use a tight conservative curved outline instead of the primitive's much larger transformed box, while malformed
    metadata still falls back safely. An installed-VRF proof recovered all 14 capsules from Valve's current
    Juggernaut model.
27. `96b3952` - added checked sloped convex gameplay volumes using paired coplanar bottom/top corner heights.
    Validation rejects mismatched, crossing, twisted, oversized, concave, or otherwise unsafe solids; reusable
    component mirroring keeps heights paired with their footprint; preview arrows point uphill; Valve's converter
    preserved the geometry; and the isolated compiler fixture produced a real VPK without launching Dota or Hammer.
28. This milestone - added offline minimap consistency checks to `map_validate`. The validator now correlates exactly
    two `dota_minimap_boundary` corners with overview KeyValues, safe source material/PNG paths, compiled material and
    hashed texture outputs, PNG dimensions, and the unrotated pixel-to-world transform. The real 3v3 overview passes:
    its 1024x1024 image at scale 16 projects exactly to the declared -8192 through +8192 world bounds.
29. This milestone - added reusable project CLIs for real GridNav and minimap tests, hardened foreground verification
    to the exact input moment, added bounded camera-telemetry focus recovery, and proved the 3v3 minimap with five
    63-unit probes. It also removed the last accidental isolated shelf and wall-blocked camp, rebuilt the VPK, and
    re-proved all four routes and all 64 real GridNav checks after segmented base walls were enabled.
30. This follow-up - made structured minimap measurement the safe CLI default and added dependency-free PNG quality
    checks so a black `PrintWindow` result cannot be mistaken for visual evidence. Focused tests cover both black-frame
    rejection and acceptance of a varied rendered frame.
31. This milestone - replaced the nonzero-rotation refusal with Valve-grounded legacy quarter-turn transforms.
    Offline validation, forward/inverse coordinate conversion, and live minimap probes now agree; fixtures cover
    north-up, nonzero `rotate=15`, square-image enforcement, and unsafe fractional values.
32. This milestone - added renderer-native Source 2 PNG evidence with strict new-file correlation, stable-write and
    pixel-quality checks, structured provenance, and fail-fast screenshot semantics. The 3v3 center probe produced a
    checked 1900x1080 frame, retained Valve's source PNG, passed at 63 units, and shut down automatically.
33. This milestone - added checked `managedSolids` for flat convex or concave world geometry. A shared Source 2 mesh
    writer validates closed half-edge topology; simple outlines reject crossings, touching edges, duplicates, unsafe
    materials, and reserved brush overrides; deterministic ear clipping creates watertight `func_brush` extrusions.
    Unified specifications, reusable mirrored components, drift repair, preview, and offline reachability all follow
    the true concave footprint. Valve's converter and resource compiler accepted the isolated L-shaped fixture.
34. This milestone - extended `managedSolids` with paired bottom/top corner heights. Concave sloped tops and bottoms
    remain a single-valued, non-intersecting surface over the checked outline; every top corner must stay above its
    matching bottom. Winding normalization and component mirroring preserve height pairing, preview marks the uphill
    direction, exact drift repair remains idempotent, and Valve compiled the second sloped L-shaped fixture.
35. This milestone - added whole-map material preflight. Every quoted `materials/...vmat` resource is deduplicated and
    resolved against addon/base loose source, compiled game assets, and addon/Dota/core VPK indexes. Build and sync dry
    runs expose the evidence, unsafe writes are refused before conversion, `map_compile` refuses blockers before
    ResourceCompiler, and `map_validate` can require compiled readiness. The real 3v3 VMAP resolves all 10 references
    (2 unique materials) with no findings; the repository compiler fixture proves its generated materials against the
    installed Valve packages before producing its VPK.
36. This milestone - added a checked rectangular `arch` structure recipe. One compact component expands into two
    rectangular posts and an elevated lintel using the existing watertight world-solid writer, with validated dimensions,
    yaw, deterministic names, and a visible material covered by whole-map preflight. Offline reachability now intersects
    solid vertical ranges with a conservative 256-unit standing corridor: posts block their true footprints while a high
    lintel leaves the opening reachable. The repository fixture includes the complete arch for Valve conversion and
    compiler proof; true holes, curved arches, and arbitrary meshes remain deliberately unsupported.
37. This milestone - added checked Valve navigation surfaces and a reusable `bridge` composition. Installed Valve
    sources showed that stock Dota bridges keep visible art separate from a `CMapMesh` using
    `materials/editor/dota_nav_walkable.vmat`; the MCP now writes that dedicated mesh through the same validated,
    watertight flat/sloped polygon pipeline as world solids. Desired-state parsing, component placement/mirroring,
    drift repair, transactions, preview, material preflight, and name-collision checks all include the new surface.
    The bridge builder couples one visible deck with its exact navigation twin. Offline analysis conservatively reports
    under-deck terrain clearance while explicitly reserving elevated route connectivity for Valve GridNav. The isolated
    repository fixture round-tripped and compiled the complete bridge without launching Dota or Hammer.
38. This milestone - added `bridgeApproach`, which derives a watertight sloped solid and exact navigation twin from
    two world-space top-surface endpoints. A disposable causal fixture relocates Valve's tile terrain 46,341 units
    from the probe site and omits visible bridge solids, leaving only two sloped approaches and one flat
    `dota_nav_walkable` deck. Valve conversion/compilation preserved all three surfaces. One bounded Dota run then
    proved a 2,048-unit crossing with both 1,024-unit segments, rejected the nearby no-surface control as
    non-traversable with path length -1, confirmed same-X/Y/different-Z probes alias to path length 0, reported no
    console errors, shut down, and removed the disposable addon. This proves the checked surface recipe causes real
    GridNav connectivity while also establishing that independent stacked navigation layers cannot be inferred from
    Dota's X/Y-only API.

## Current verification record

- TypeScript build passes.
- Default suite: 285 passed, 0 failed, and 3 opt-in compiler/installed-VRF tests skipped.
- MCP smoke suite: 200 passed, 0 failed, and 1 network-dependent Workshop search skipped.
- Installed recipe fingerprint is verified against Dota app build `24541331`, source revision `10879186`,
  Workshop-tools depot manifest `8024482296929360461`, and five authoritative source/tool hashes.
- The guided refresh runner completed all four safe checks in 33 seconds without opening Dota or Hammer. Because the
  installed fingerprint still matches, it correctly emitted `no-refresh-needed` and refused baseline recording.
- Valve's installed `dmxconvert.exe` successfully round-trips generated camp, polygonal no-ward, player-clip, and
  sloped trigger volumes from text to binary VMAP and back during the integration suite, preserving exact corner heights.
- `npm run test:compiler-fixture` successfully round-tripped and compiled the repository-owned acceptance payload,
  including its sloped trigger, flat and sloped concave L-shaped world solids, checked rectangular arch, checked bridge
  deck/navigation twin, complete visible sloped bridge approach/navigation twin, and explicit navigation obstruction,
  into a real VPK. The generated map uses Valve's installed blank template only as required hidden
  infrastructure, depends on no private 3v3 file, stores no copied Valve VMAP, and leaves no temporary addon trees.
- `npm run test:compiler-bridge-nav-fixture` and `npm run test:engine-bridge-nav-fixture` passed on the installed
  Workshop Tools. The latter produced fresh DebugSDK 1.4.0 state-4 readiness, the expected positive/negative/height-
  alias results, zero console errors, automatic shutdown, and complete fixture cleanup.
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
- Real Dota 3v3 minimap: both boundary entities, overview metadata, 1024x1024 PNG, source/compiled material and
  hashed texture, and the scale-16 world transform validate with zero findings.
- Offline 3v3 terrain: zero holes, zero inaccessible camps, and only the deliberate 384-cell off-map strip.
- Installed official definitions expose 187 enum properties with 1,171 choices, 16 explicitly ranged properties,
  and 297 named-destination fields. All 157 acceptance-map entities are recognized with zero invalid types,
  choices, ranges, or unresolved named destinations.
- Valve prefab references: 13 of 13 found in the installed Workshop Tools.
- Acceptance map compiled successfully to `three_vs_three_blockout.vpk` on 2026-08-05.
- The acceptance VMAP now contains two checked 32-sided boss no-ward prisms generated from one reusable component;
  both are contract-idempotent, visible in the diagnostic preview, and included in the fresh compiled VPK.
- Final offline acceptance: compiled map present, zero validation errors, 3,619 walkable cells,
  3,235 cells connected to the spawn network, zero terrain holes, and one known isolated-region warning
  (the deliberate 384-cell off-map strip).
- Final diagnostic preview: 469 cliff cells, 127 ramp cells, 564 water cells, 94 entity overlays,
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
