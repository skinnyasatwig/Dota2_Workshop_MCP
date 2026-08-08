import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditStaticPropPalettePreview,
  staticPropPalettePreviewPlan,
} from "../src/dota/palette-preview.js";

test("palette preview plans exact bounded visual-only resources", () => {
  const plan = staticPropPalettePreviewPlan("river-wetland");
  assert.equal(plan.label, "River wetland");
  assert.equal(plan.collision, "none");
  assert.equal(plan.items.length, 4);
  assert.deepEqual(plan.items.map((item) => item.variant), [
    "cattails-a",
    "cattails-b",
    "cattails-c",
    "lily-pads",
  ]);
  assert.ok(plan.items.every((item) => item.compiledPath === `${item.model}_c`.toLowerCase()));
  assert.equal(new Set(plan.items.map((item) => item.compiledPath)).size, 4);
});

test("palette preview audit accepts only current VPK CRCs", () => {
  const plan = staticPropPalettePreviewPlan("natural-cliffs");
  const entries = new Map(
    plan.items.map((item) => [item.compiledPath, { crc: item.expectedCrc }]),
  );
  const current = auditStaticPropPalettePreview(plan, entries);
  assert.equal(current.current, true);
  assert.equal(current.installedCount, 4);
  assert.equal(current.currentCount, 4);
  assert.deepEqual(current.missing, []);
  assert.deepEqual(current.stale, []);

  entries.delete(plan.items[0].compiledPath);
  entries.set(plan.items[1].compiledPath, { crc: 123 });
  const changed = auditStaticPropPalettePreview(plan, entries);
  assert.equal(changed.current, false);
  assert.equal(changed.installedCount, 3);
  assert.equal(changed.currentCount, 2);
  assert.deepEqual(changed.missing, [plan.items[0].model]);
  assert.deepEqual(changed.stale, [{
    variant: plan.items[1].variant,
    model: plan.items[1].model,
    expectedCrc: plan.items[1].expectedCrc,
    installedCrc: 123,
  }]);
});
