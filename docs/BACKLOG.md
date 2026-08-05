# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Run the attached engine acceptance check (Human + engine).** The NVIDIA global and Dota profiles were backed up and restored through NVAPI, but direct startup still reports `NVAPI_ACCESS_DENIED`; explicit Steam `-applaunch` also failed to create a Dota process. Start Workshop Tools normally from the Steam UI, load the compiled 3v3 map, and leave it running. Then call readiness and GridNav once with `attachToRunningDota:true` and `compile:false`. The MCP will preserve the user-started session. Do not repeat automatic launch attempts meanwhile.
2. **Engine navigation fixture (Engine).** Once readiness is resolved, save a known-good tiny map fixture whose GridNav endpoint and segment results are stable across runs.
3. **Minimap image verification (Human visual judgment).** Compare generated bounds and camera transforms with an in-game screenshot and add a golden fixture after alignment is confirmed.
4. **Model collision precision (Research).** Per-part bind poses and all four static Rubikon shape families are decoded. Convex hulls use exact vertices, meshes use conservative vertex envelopes, and spheres/capsules use transformed bounds. Add curved outlines or concave mesh handling only if it materially improves tile-scale diagnostics without misrepresenting the physics. Dynamic and team-selective collision remain engine-only facts.
5. **General solid geometry (Valve-format research).** Convex vertical prisms are proven. Concave, sloped, curved, or decorative meshes remain intentionally unsupported until a safe representation and test corpus exist.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
