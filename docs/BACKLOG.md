# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Restore NVIDIA driver profiles, then rerun readiness (Human + engine).** The probe proved that Dota is blocked before its game window exists by `NVAPI_ACCESS_DENIED`; both the configured renderer and an explicit Vulkan run fail the same way. Restore the Dota application profile and global 3D profile to NVIDIA defaults, resolve the visible Steam Cloud warning, then run one readiness probe followed by one GridNav test. Do not keep relaunching until the profile repair is complete.
2. **Engine navigation fixture (Engine).** Once readiness is resolved, save a known-good tiny map fixture whose GridNav endpoint and segment results are stable across runs.
3. **Minimap image verification (Human visual judgment).** Compare generated bounds and camera transforms with an in-game screenshot and add a golden fixture after alignment is confirmed.
4. **Model collision refinement (Research).** Base-game and loose compiled addon props now use cached bounds recovered only from real model `PHYS` blocks. Add packed-addon archive lookup, pitched/rolled transforms, and—only if VRF exposes a stable representation—exact convex hull surfaces. Dynamic and team-selective collision remain engine-only facts.
6. **General solid geometry (Valve-format research).** Convex vertical prisms are proven. Concave, sloped, curved, or decorative meshes remain intentionally unsupported until a safe representation and test corpus exist.
7. **Baseline refresh workflow (Maintenance).** When recipe-version checks detect a real Valve change, provide a guided re-decompile/re-test report before a maintainer intentionally records new hashes; never auto-bless an update.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
