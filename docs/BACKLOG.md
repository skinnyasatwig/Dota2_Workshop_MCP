# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Minimap image verification (Human visual judgment).** Compare generated bounds and camera transforms with an in-game screenshot and add a golden fixture after alignment is confirmed.
2. **General world geometry (Valve-format research).** Flat and sloped convex gameplay volumes are compiler-proven. Concave, curved, terrain-bearing, or decorative world meshes remain intentionally unsupported until a safe representation and test corpus exist.
3. **Machine-specific direct-launch compatibility (Research).** The autonomous Steam tools launch/load/test/shutdown sequence is proven. Revisit direct-launch NVIDIA behavior only after a Valve/NVIDIA change or new evidence; do not burn retries on an unchanged condition.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
