# Automation improvement progress

Last updated: 2026-08-04

## Verified milestones

1. `1110197` — unified map tools around one validated specification.
2. `5bb15e6` — added dry-run reports, transactions, backups, and rollback.
3. `3c48eff` — added diagnostic previews and offline whole-map reachability.
4. `e348177` — added reusable components, checked Dota structures, Valve terrain/prefab recipes, and official FGD validation.
5. `bdec2f0` — added guarded one-launch GridNav testing and automatic shutdown.
6. `b877b03` — added a bounded Steam-to-direct launch fallback when Steam ignores `-applaunch`.
7. Working tree — added and live-tested a dedicated one-launch readiness probe with state timeline,
   console filtering, early fatal/modal detection, dialog/process diagnosis, screenshot capture, checked
   DX11/Vulkan overrides, and mandatory shutdown.

## Current verification record

- TypeScript build passes.
- 172 unit and integration tests pass.
- MCP smoke suite: 193 passed, 0 failed, 1 skipped because the remote Steam Workshop search service was unavailable.
- Real Dota 3v3 contract: 86 managed entities, 4 managed paths, 97 terrain operations, and zero desired-state drift.
- Offline 3v3 terrain: zero holes; only two known isolated regions (a tiny shelf and a deliberate off-map strip).
- Official entity definitions: all 157 map entities recognized; zero invalid known property values.
- Valve prefab references: 13 of 13 found in the installed Workshop Tools.
- Acceptance map compiled successfully to `three_vs_three_blockout.vpk` on 2026-08-04.
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
