# Ordered remaining backlog

Items are ordered by leverage. “Human” means the MCP should not guess.

1. **General world geometry (Valve-format research).** Flat/sloped convex volumes and segmented curved/concave player-blocking wall outlines are compiler-safe. Terrain-bearing or decorative concave meshes remain intentionally unsupported until a safe representation and test corpus exist.
2. **Rotated minimap transforms (Research).** Offline and live click verification support north-up (`rotate=0`) overviews. Add explicit rotation math and a fixture before accepting rotated metadata.
3. **Native HUD drift (Maintenance).** The camera bridge checks several known minimap panel ids and accepts an explicit rectangle fallback. Add newly observed Valve ids only from real evidence rather than guessing.
4. **Renderer-safe screenshot evidence (Research).** Live minimap coordinates are proven, but `PrintWindow` returned a black frame on the acceptance machine and per-probe capture can disturb Panorama timing. Keep measurement-only mode as the reliable default for calibration; add a checked non-black capture path before calling screenshots portable.
5. **Machine-specific direct-launch compatibility (Research).** The autonomous Steam tools launch/load/test/shutdown sequence is proven. Revisit direct-launch NVIDIA behavior only after a Valve/NVIDIA change or new evidence; do not burn retries on an unchanged condition.

Gameplay redesign of the 3v3 map is deliberately outside this backlog. The map is an integration test here, not a reason to invent mechanics.
