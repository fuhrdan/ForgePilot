import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScriptedPlanner } from "../src/planners/scripted.js";
import { runTaskWithRepairs } from "../src/orchestration/repair-loop.js";
import { createTaskId, loadState } from "../src/core/state.js";

async function tempWorkspace() {
    return fs.mkdtemp(path.join(os.tmpdir(), "forgepilot-repair-"));
}

function taskWithBrokenProgram() {
    return {
        goal: "Repair a deliberately broken program",
        actions: [
            { type: "write_file", path: "app.js", content: "console.error('broken');\nprocess.exit(1);\n" },
            { type: "run_command", command: "node", args: ["app.js"], expectExitCode: 0 }
        ],
        verify: [
            { type: "command", command: "node", args: ["app.js"], expectExitCode: 0, stdoutIncludes: "fixed" }
        ],
        repairs: [
            {
                rationale: "Replace the failing program body with a successful result.",
                actions: [
                    {
                        type: "replace_text",
                        path: "app.js",
                        find: "console.error('broken');\nprocess.exit(1);",
                        replace: "console.log('fixed');",
                        expectedOccurrences: 1
                    }
                ]
            }
        ]
    };
}

test("repair loop patches a failed action and retries it", async () => {
    const workspace = await tempWorkspace();
    const task = taskWithBrokenProgram();
    const planner = new ScriptedPlanner();
    const result = await runTaskWithRepairs({
        task,
        planner,
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 2,
        taskId: "repair-action"
    });

    assert.equal(result.verification.passed, true);
    assert.equal(result.repairCount, 1);
    assert.equal(result.repairs[0].retry.status, "passed");
    assert.match(await fs.readFile(path.join(workspace, "app.js"), "utf8"), /fixed/);
});

test("repair loop can repair a final verification failure", async () => {
    const workspace = await tempWorkspace();
    const task = {
        goal: "Repair verification",
        actions: [{ type: "write_file", path: "result.txt", content: "bad" }],
        verify: [{ type: "file_contains", path: "result.txt", text: "good" }],
        repairs: [{ actions: [{ type: "replace_text", path: "result.txt", find: "bad", replace: "good" }] }]
    };

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 1,
        taskId: "repair-verify"
    });

    assert.equal(result.verification.passed, true);
    assert.equal(result.repairCount, 1);
    assert.equal(result.repairs[0].trigger.kind, "verification");
});

test("repair budget prevents an unbounded loop", async () => {
    const workspace = await tempWorkspace();
    const task = {
        goal: "Stay broken",
        actions: [
            { type: "write_file", path: "bad.js", content: "process.exit(1);" },
            { type: "run_command", command: "node", args: ["bad.js"], expectExitCode: 0 }
        ],
        verify: [],
        repairs: [{ actions: [] }]
    };

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 1,
        taskId: "repair-budget"
    });

    assert.equal(result.verification.passed, false);
    assert.equal(result.repairCount, 1);
    assert.match(result.verification.skipped, /budget exhausted/);
});

test("failed task checkpoint can resume with additional repair budget", async () => {
    const workspace = await tempWorkspace();
    const task = taskWithBrokenProgram();
    const taskFile = path.join(workspace, "task.json");
    await fs.writeFile(taskFile, JSON.stringify(task), "utf8");
    const taskId = createTaskId(taskFile, task);
    const planner = new ScriptedPlanner();

    const failed = await runTaskWithRepairs({
        task,
        planner,
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId
    });
    assert.equal(failed.verification.passed, false);

    const checkpoint = await loadState(workspace, taskId);
    assert.equal(checkpoint.actionIndex, 1);
    assert.equal(checkpoint.status, "failed");

    const resumed = await runTaskWithRepairs({
        task,
        planner,
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 1,
        taskId,
        resumeState: checkpoint
    });

    assert.equal(resumed.resumed, true);
    assert.equal(resumed.verification.passed, true);
    assert.equal(resumed.repairCount, 1);
});
