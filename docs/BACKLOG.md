# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Launch-to-map orchestration (Engine).** The normal Steam Workshop Tools process now starts with the addon and VConsole, but it can remain on the dashboard. Teach the guarded engine runner to wait for a real window, handle a transient watchdog stall safely, explicitly issue `dota_launch_custom_game`, require a fresh DebugSDK handshake, then run navigation and shut down. Keep each stage bounded and diagnostic.
2. **Engine navigation fixture (Engine).** Save a known-good tiny map fixture whose GridNav endpoint and segment results are stable across runs, including one intentionally blocked route for negative coverage and an asserted repair suggestion.
3. **Minimap image verification (Human visual judgment).** Compare generated bounds and camera transforms with an in-game screenshot and add a golden fixture after alignment is confirmed.
4. **Model collision precision (Research).** Per-part bind poses and all four static Rubikon shape families are decoded. Convex hulls use exact vertices, meshes use conservative vertex envelopes, and spheres/capsules use transformed bounds. Add curved outlines or concave mesh handling only if it materially improves tile-scale diagnostics without misrepresenting the physics. Dynamic and team-selective collision remain engine-only facts.
5. **General solid geometry (Valve-format research).** Convex vertical prisms are proven. Concave, sloped, curved, or decorative meshes remain intentionally unsupported until a safe representation and test corpus exist.
6. **Machine-specific launch compatibility (Research).** The Steam tools process and explicit map-load sequence are proven. Revisit direct-launch NVIDIA behavior only after a Valve/NVIDIA change or new evidence; do not burn retries on an unchanged condition.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
