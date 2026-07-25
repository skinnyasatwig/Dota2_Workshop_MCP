import { test } from "node:test";
import assert from "node:assert/strict";
import { gameStateFromPong } from "../src/tools/control.tools.js";

test("gameStateFromPong reads a ready game state", () => {
  assert.equal(gameStateFromPong("[MCP] PONG v=0.3.0 t=1.25 state=7"), 7);
});

test("gameStateFromPong preserves state zero and rejects unrelated output", () => {
  assert.equal(gameStateFromPong("[MCP] PONG v=0.3.0 t=0.00 state=0"), 0);
  assert.equal(gameStateFromPong("mcp_ping"), undefined);
});
