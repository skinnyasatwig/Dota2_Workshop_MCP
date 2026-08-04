# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Restore NVIDIA driver profiles, then rerun readiness (Human + engine).** The probe proved that Dota is blocked before its game window exists by `NVAPI_ACCESS_DENIED`; both the configured renderer and an explicit Vulkan run fail the same way. Restore the Dota application profile and global 3D profile to NVIDIA defaults, resolve the visible Steam Cloud warning, then run one readiness probe followed by one GridNav test. Do not keep relaunching until the profile repair is complete.
2. **Polygonal/circular volume authoring (Valve-format research).** Rectangular camp, trigger, no-ward, boss-attackable, and player-clip recipes are complete. Add checked polygon extrusion only after Valve topology can be generated and round-tripped without guessing; use it for exact circular boss boundaries.
3. **Engine navigation fixture (Engine).** Once readiness is resolved, save a known-good tiny map fixture whose GridNav endpoint and segment results are stable across runs.
4. **Valve recipe versioning (Valve-format research).** Record Dota build/version fingerprints beside terrain, cliff, ramp, prefab, volume, and point-blocker recipes; warn when the installed game differs from the last verification.
5. **Official property semantics (Valve-format research).** Extend FGD type validation with safe enum/range/reference checks where Valve files expose enough information.
6. **Broader collision-aware preview (Research).** Add known prop/tree footprints so more engine-only blockers can be caught before launch. Checked player-clip footprints are already included.
7. **Minimap image verification (Human visual judgment).** Compare generated bounds and camera transforms with an in-game screenshot and add a golden fixture after alignment is confirmed.
8. **CI-friendly licensed map fixture (Repository decision).** Check in or generate a small legal VMAP fixture so compile/conversion tests can run on machines with Workshop Tools without depending on the private 3v3 project.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
