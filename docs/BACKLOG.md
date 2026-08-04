# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Supervised engine-readiness check (Human + engine).** Open the compiled 3v3 map once and observe whether it reaches hero selection, stalls on a modal, or remains in the tools shell. Then run one diagnostic engine navigation test and use its preserved console/window evidence.
2. **Safe solid-volume authoring (Valve-format research).** Add checked brush/mesh volume recipes for camp bounds, no-ward volumes, base blockers, vision blockers, and trigger areas. Refuse unknown solid layouts.
3. **Engine navigation fixture (Engine).** Once readiness is resolved, save a known-good tiny map fixture whose GridNav endpoint and segment results are stable across runs.
4. **Valve recipe versioning (Valve-format research).** Record Dota build/version fingerprints beside terrain, cliff, ramp, and prefab recipes; warn when the installed game differs from the last verification.
5. **Official property semantics (Valve-format research).** Extend FGD type validation with safe enum/range/reference checks where Valve files expose enough information.
6. **Collision-aware preview (Research).** Add known prop/tree/solid footprints to the offline map and preview so more engine-only blockers can be caught before launch.
7. **Minimap image verification (Human visual judgment).** Compare generated bounds and camera transforms with an in-game screenshot and add a golden fixture after alignment is confirmed.
8. **CI-friendly licensed map fixture (Repository decision).** Check in or generate a small legal VMAP fixture so compile/conversion tests can run on machines with Workshop Tools without depending on the private 3v3 project.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
