import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScriptedPlanner } from "../src/planners/scripted.js";
import { runTaskWithRepairs } from "../src/orchestration/repair-loop.js";
import { buildRepositoryContext } from "../src/repository/context.js";
import { collectCoverage } from "../src/testing/coverage.js";

async function tempWorkspace(prefix = "forgepilot-v04-") {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeNodeProject(workspace, source = "export function add(a, b) { return 0; }\n") {
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({
        name: "forgepilot-test-first-fixture",
        type: "module",
        scripts: { test: "node --test", build: "node --check src/math.js" }
    }), "utf8");
    await fs.writeFile(path.join(workspace, "src", "math.js"), source, "utf8");
}

function regressionTestContent() {
    return `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/math.js";\ntest("add returns the arithmetic sum", () => assert.equal(add(2, 3), 5));\n`;
}

function taskFor(sourceFind = "return 0;", sourceReplace = "return a + b;") {
    return {
        goal: "Fix add and prove it with a regression test",
        testFirst: {
            testActions: [{ type: "write_file", path: "test/math.test.js", content: regressionTestContent() }],
            red: { command: "node", args: ["--test", "test/math.test.js"], failureIncludes: "Expected values to be strictly equal" },
            green: { command: "node", args: ["--test", "test/math.test.js"] },
            build: { command: "node", args: ["--check", "src/math.js"] }
        },
        actions: [{ type: "replace_text", path: "src/math.js", find: sourceFind, replace: sourceReplace }],
        verify: [{ type: "file_contains", path: "src/math.js", text: sourceReplace }]
    };
}

test("repository intelligence inventories tests and derives a targeted Node test gate", async () => {
    const workspace = await tempWorkspace();
    await writeNodeProject(workspace);
    await fs.mkdir(path.join(workspace, "test"));
    await fs.writeFile(path.join(workspace, "test", "math.test.js"), regressionTestContent(), "utf8");
    await fs.writeFile(path.join(workspace, "test", "unrelated.test.js"), "import test from 'node:test'; test('x',()=>{});\n", "utf8");

    const context = await buildRepositoryContext(workspace, { goal: "fix math add" });
    assert.equal(context.testing.testFileCount, 2);
    assert.equal(context.testing.selectedTests[0], "test/math.test.js");
    assert.equal(context.testing.primaryTestCommand.command, "npm");
    assert.deepEqual(context.testing.targetedTestCommand, { kind: "targeted-test", command: "node", args: ["--test", "test/math.test.js"] });
});

test("test-first workflow records valid RED then requires GREEN/regression/build gates", async () => {
    const workspace = await tempWorkspace();
    await writeNodeProject(workspace);
    const task = taskFor();

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId: "test-first-success"
    });

    assert.equal(result.testFirst.red.validRed, true);
    assert.equal(result.verification.passed, true);
    assert.ok(result.verification.checks.some((check) => check.type === "test_gate" && check.phase === "green" && check.status === "passed"));
    assert.ok(result.verification.checks.some((check) => check.type === "test_gate" && check.phase === "regression" && check.status === "passed"));
    assert.ok(result.verification.checks.some((check) => check.type === "test_gate" && check.phase === "build" && check.status === "passed"));
    assert.ok(result.verification.checks.some((check) => check.type === "test_integrity" && check.status === "passed"));
});

test("false-green regression test blocks implementation", async () => {
    const workspace = await tempWorkspace();
    await writeNodeProject(workspace, "export function add(a, b) { return a + b; }\n");
    const task = taskFor("return a + b;", "return a + b + 0;");

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId: "false-green"
    });

    assert.equal(result.testFirst.red.validRed, false);
    assert.equal(result.verification.passed, false);
    assert.match(result.verification.skipped, /already green/i);
    assert.equal(result.actions.length, 0);
    const source = await fs.readFile(path.join(workspace, "src", "math.js"), "utf8");
    assert.ok(!source.includes("+ 0"));
});

test("RED gate rejects a failure caused by the wrong reason", async () => {
    const workspace = await tempWorkspace();
    await writeNodeProject(workspace);
    const task = taskFor();
    task.testFirst.red.failureIncludes = "THIS_SIGNATURE_WILL_NOT_APPEAR";

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId: "wrong-red-reason"
    });

    assert.equal(result.testFirst.red.validRed, false);
    assert.equal(result.testFirst.red.signatureMatched, false);
    assert.match(result.testFirst.red.reason, /not for the expected reason/i);
    assert.equal(result.actions.length, 0);
});

test("missing or blocked test runner does not count as RED", async () => {
    const workspace = await tempWorkspace();
    await writeNodeProject(workspace);
    const task = taskFor();
    task.testFirst.red = { command: "not-a-real-runner", args: [] };

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId: "missing-runner"
    });

    assert.equal(result.testFirst.red.validRed, false);
    assert.match(result.testFirst.red.reason, /infrastructure failed/i);
    assert.equal(result.actions.length, 0);
});

test("implementation phase cannot weaken a RED-proven test", async () => {
    const workspace = await tempWorkspace();
    await writeNodeProject(workspace);
    const task = taskFor();
    task.actions.unshift({ type: "replace_text", path: "test/math.test.js", find: "5));", replace: "0));" });

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId: "protected-test"
    });

    assert.equal(result.testFirst.red.validRed, true);
    assert.equal(result.verification.passed, false);
    assert.ok(result.actions.some((item) => item.status === "failed" && /cannot modify/i.test(item.error ?? "")));
});

test("GREEN gate failure can trigger bounded source repair without editing the test", async () => {
    const workspace = await tempWorkspace();
    await writeNodeProject(workspace);
    const task = taskFor("return 0;", "return a - b;");
    task.repairs = [{
        rationale: "Correct the arithmetic implementation.",
        actions: [{ type: "replace_text", path: "src/math.js", find: "return a - b;", replace: "return a + b;" }]
    }];
    task.verify = [];

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 1,
        taskId: "green-repair"
    });

    assert.equal(result.testFirst.red.validRed, true);
    assert.equal(result.repairCount, 1);
    assert.equal(result.verification.passed, true);
    assert.equal(result.repairs[0].trigger.kind, "verification");
    assert.ok(result.verification.checks.some((check) => check.type === "test_integrity" && check.status === "passed"));
});

test("LCOV coverage is ingested when an artifact is available", async () => {
    const workspace = await tempWorkspace();
    await fs.mkdir(path.join(workspace, "coverage"));
    await fs.writeFile(path.join(workspace, "coverage", "lcov.info"), "TN:\nSF:src/math.js\nLF:10\nLH:8\nFNF:2\nFNH:1\nBRF:4\nBRH:3\nend_of_record\n", "utf8");
    const coverage = await collectCoverage(workspace);
    assert.equal(coverage.available, true);
    assert.equal(coverage.lines.pct, 80);
    assert.equal(coverage.functions.pct, 50);
    assert.equal(coverage.branches.pct, 75);
});
