# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **General world geometry (Valve-format research).** Flat/sloped convex volumes and segmented curved/concave player-blocking wall outlines are compiler-safe. Terrain-bearing or decorative concave meshes remain intentionally unsupported until a safe representation and test corpus exist.
2. **Native HUD drift (Maintenance).** The camera bridge checks several known minimap panel ids and accepts an explicit rectangle fallback. Add newly observed Valve ids only from real evidence rather than guessing.
3. **Machine-specific direct-launch compatibility (Research).** The autonomous Steam tools launch/load/test/shutdown sequence is proven. Revisit direct-launch NVIDIA behavior only after a Valve/NVIDIA change or new evidence; do not burn retries on an unchanged condition.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
