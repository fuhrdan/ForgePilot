import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executePlan } from "../src/actions/executor.js";
import { verifyPlan } from "../src/verification/verifier.js";

async function tempWorkspace() {
    return fs.mkdtemp(path.join(os.tmpdir(), "forgepilot-"));
}

test("plan-only does not write files", async () => {
    const workspace = await tempWorkspace();
    const plan = { actions: [{ type: "write_file", path: "a.txt", content: "hello" }], verify: [] };
    const results = await executePlan(plan, workspace, { apply: false });
    assert.equal(results[0].status, "planned");
    await assert.rejects(fs.access(path.join(workspace, "a.txt")));
});

test("apply writes file and verifier checks it", async () => {
    const workspace = await tempWorkspace();
    const plan = {
        actions: [{ type: "write_file", path: "a.txt", content: "hello forgepilot" }],
        verify: [
            { type: "file_exists", path: "a.txt" },
            { type: "file_contains", path: "a.txt", text: "forgepilot" }
        ]
    };
    const results = await executePlan(plan, workspace, { apply: true });
    assert.equal(results[0].status, "passed");
    const verification = await verifyPlan(plan, workspace, { apply: true });
    assert.equal(verification.passed, true);
});

test("command allowlist blocks shell", async () => {
    const workspace = await tempWorkspace();
    const plan = { actions: [{ type: "run_command", command: "sh", args: ["-c", "echo bad"] }], verify: [] };
    await assert.rejects(executePlan(plan, workspace, { apply: true }), /not allowlisted/);
});

test("replace_text applies a surgical patch with occurrence guard", async () => {
    const workspace = await tempWorkspace();
    await fs.writeFile(path.join(workspace, "patch.txt"), "alpha beta alpha", "utf8");
    const plan = {
        actions: [{ type: "replace_text", path: "patch.txt", find: "beta", replace: "fixed", expectedOccurrences: 1 }],
        verify: []
    };
    const results = await executePlan(plan, workspace, { apply: true });
    assert.equal(results[0].status, "passed");
    assert.equal(await fs.readFile(path.join(workspace, "patch.txt"), "utf8"), "alpha fixed alpha");
});

test("replace_text refuses ambiguous patches", async () => {
    const workspace = await tempWorkspace();
    await fs.writeFile(path.join(workspace, "patch.txt"), "same same", "utf8");
    const plan = {
        actions: [{ type: "replace_text", path: "patch.txt", find: "same", replace: "x", expectedOccurrences: 1 }],
        verify: []
    };
    const results = await executePlan(plan, workspace, { apply: true });
    assert.equal(results[0].status, "failed");
    assert.match(results[0].error, /found 2/);
});
