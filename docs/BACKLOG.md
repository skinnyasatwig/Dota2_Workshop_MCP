# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Correct the acceptance map's four mirrored route waypoints (Map integration).** Real GridNav completed all 64 checks. The waypoint at `(±4224, ±2816, 256)` is non-traversable on each north/south route, so segment 1 and segment 2 fail while all later segments pass. Fix the terrain/route source in the parent map repository, rebuild, then use one attached GridNav run as proof. Do not hide this by loosening MCP validation.
2. **Engine navigation fixture (Engine).** Save a known-good tiny map fixture whose GridNav endpoint and segment results are stable across runs, including one intentionally blocked route for negative coverage.
3. **Minimap image verification (Human visual judgment).** Compare generated bounds and camera transforms with an in-game screenshot and add a golden fixture after alignment is confirmed.
4. **Model collision precision (Research).** Per-part bind poses and all four static Rubikon shape families are decoded. Convex hulls use exact vertices, meshes use conservative vertex envelopes, and spheres/capsules use transformed bounds. Add curved outlines or concave mesh handling only if it materially improves tile-scale diagnostics without misrepresenting the physics. Dynamic and team-selective collision remain engine-only facts.
5. **General solid geometry (Valve-format research).** Convex vertical prisms are proven. Concave, sloped, curved, or decorative meshes remain intentionally unsupported until a safe representation and test corpus exist.
6. **Automatic launch compatibility (Machine-specific research).** The normal Workshop Tools attach path is proven, but direct launch still encounters `NVAPI_ACCESS_DENIED` and Steam did not forward `-applaunch` on this PC. Revisit only after a Valve/NVIDIA change or new evidence; do not burn retries on the unchanged condition.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
