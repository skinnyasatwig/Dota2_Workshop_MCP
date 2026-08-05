# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Minimap image verification (Human visual judgment).** Compare generated bounds and camera transforms with an in-game screenshot and add a golden fixture after alignment is confirmed.
2. **Model collision precision (Research).** Per-part bind poses and all four static Rubikon shape families are decoded. Convex hulls use exact vertices, meshes use conservative vertex envelopes, and spheres/capsules use transformed bounds. Add curved outlines or concave mesh handling only if it materially improves tile-scale diagnostics without misrepresenting the physics. Dynamic and team-selective collision remain engine-only facts.
3. **General solid geometry (Valve-format research).** Convex vertical prisms are proven. Concave, sloped, curved, or decorative meshes remain intentionally unsupported until a safe representation and test corpus exist.
4. **Machine-specific direct-launch compatibility (Research).** The autonomous Steam tools launch/load/test/shutdown sequence is proven. Revisit direct-launch NVIDIA behavior only after a Valve/NVIDIA change or new evidence; do not burn retries on an unchanged condition.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
