import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveInside } from "../src/core/paths.js";

test("resolveInside permits child paths", () => {
    const root = path.resolve("/tmp/forgepilot-test");
    assert.equal(resolveInside(root, "src/app.js"), path.join(root, "src/app.js"));
});

test("resolveInside rejects traversal", () => {
    const root = path.resolve("/tmp/forgepilot-test");
    assert.throws(() => resolveInside(root, "../escape.txt"), /escapes workspace/);
});
