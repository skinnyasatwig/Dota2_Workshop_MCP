# Dota map automation capabilities

This is the plain-language answer to “what can the MCP do without Hammer now?”

| Capability | Status | What it means | Remaining limit |
|---|---|---|---|
| One map specification | Ready | Build, terrain, sync, preview, validation, and engine-route tools read the same checked JSON contract. | A malformed or ambiguous contract is rejected instead of guessed. |
| Terrain generation | Ready | Rectangles, circles, rings, paths, polygons, named regions, water, height, tilesets, cliffs, and ramps can be generated repeatably. | Arbitrary Source 2 polygon meshes still need Hammer or more Valve-format research. |
| Reuse and symmetry | Ready | Regions, paths, and whole components can be mirrored and placed repeatedly with automatic name isolation. | Visual composition still needs a human eye. |
| Safe writes | Ready | Dry-run reports, staging, backups, transactional replacement, and rollback protect source and compiled maps. | Git remains the long-term history; transaction backups are short-term recovery. |
| Diagnostic preview | Ready | A top-down image shows terrain, contours, cliffs, ramps, water/currents, paths, entities, tower ranges, camps, objectives, minimap bounds, holes, and unreachable areas. | It is a diagnostic drawing, not the final in-game rendering. |
| Offline reachability | Ready | The tile grid can find holes, trapped spawns, isolated land, blocked entrances, inaccessible objectives, and bad path segments without launching Dota. | Props, trees, brush collision, and Valve's compiled navigation are engine facts. |
| Real Dota navigation | Implemented; live readiness unresolved | `map_engine_nav_test` compiles, performs one guarded launch, queries `GridNav`, returns structured route results, and always shuts down. | On the current 3v3 acceptance run, Dota reached VConsole but not game state 3, so no route result was produced. Future failures now retain console and window diagnostics. |
| Reusable Dota structures | Ready for point-entity structures | Bases, Ancients, towers, fountains, shops, camps, boss pits, player starts, and gates have checked builders and stock names. | Real solid trigger/camp volumes and bespoke walls need safe brush-volume authoring. |
| Valve recipe library | Ready, version-sensitive | Known terrain cores, cliff/ramp patterns, and installed Valve prefab references are catalogued and verified locally. | Valve can change assets or formats after Dota updates; recipes need re-verification. |
| Entity validation | Ready for official FGD data | Known classes, inherited properties, and property types are checked against installed Valve definitions. | Runtime-only behavior and undocumented custom metadata cannot be proven by FGD files. |
| Automated verification | Ready | The TypeScript build, unit/integration tests, MCP smoke suite, real 3v3 contract sync, preview, reachability, FGD checks, and compile are reproducible. | Final visuals and the current engine-readiness issue need a human/engine session. |

## What “minimal Hammer interaction” means

Most layout iteration can now happen in JSON plus generated previews. Hammer is still the right tool for final visual dressing, arbitrary mesh sculpting, authored solid volumes, and visual inspection. The goal is not to pretend Hammer no longer exists; it is to reserve Hammer for the parts only Hammer can reliably judge.
