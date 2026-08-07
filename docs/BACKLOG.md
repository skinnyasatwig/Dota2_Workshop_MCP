# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **Richer world geometry (Valve-format research).** Flat or per-corner-sloped convex/concave solid extrusions, flat/sloped convex gameplay volumes, and segmented player-blocking wall outlines are compiler-safe. Next, add evidence-backed recipes for holes/arches, bridge walkability, and decorative material composition without exposing arbitrary unsafe triangle soup.
2. **Native HUD drift (Maintenance).** The camera bridge checks several known minimap panel ids and accepts an explicit rectangle fallback. Add newly observed Valve ids only from real evidence rather than guessing.
3. **Machine-specific direct-launch compatibility (Research).** The autonomous Steam tools launch/load/test/shutdown sequence is proven. Revisit direct-launch NVIDIA behavior only after a Valve/NVIDIA change or new evidence; do not burn retries on an unchanged condition.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
