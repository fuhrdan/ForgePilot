import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContainerExecutionProvider } from "../src/sandbox/provider.js";
import { createSandboxSession } from "../src/sandbox/session.js";
import { runTaskWithRepairs } from "../src/orchestration/repair-loop.js";
import { ScriptedPlanner } from "../src/planners/scripted.js";

async function tempWorkspace() {
    return fs.mkdtemp(path.join(os.tmpdir(), "forgepilot-v05-"));
}

test("container provider builds a hardened Docker invocation", async () => {
    const workspace = await tempWorkspace();
    let captured;
    const provider = new ContainerExecutionProvider({
        runtime: "docker",
        workspaceRoot: workspace,
        image: "node:22-bookworm",
        cpus: "1.5",
        memory: "768m",
        pidsLimit: 64,
        runner: async (spec) => {
            captured = spec;
            return { exitCode: 0, stdout: "ok\n", stderr: "", timedOut: false, durationMs: 1 };
        }
    });

    const result = await provider.run({ command: "node", args: ["app.js"], cwd: workspace });
    assert.equal(result.exitCode, 0);
    assert.equal(captured.command, "docker");
    assert.ok(captured.args.includes("--network"));
    assert.ok(captured.args.includes("none"));
    assert.ok(captured.args.includes("--cap-drop"));
    assert.ok(captured.args.includes("ALL"));
    assert.ok(captured.args.includes("no-new-privileges"));
    assert.ok(captured.args.includes("1.5"));
    assert.ok(captured.args.includes("768m"));
    assert.ok(captured.args.includes("64"));
    assert.ok(captured.args.includes("node:22-bookworm"));
    assert.equal(captured.args.at(-2), "node");
    assert.equal(captured.args.at(-1), "app.js");
});

test("container provider preserves the executable allowlist boundary", async () => {
    const workspace = await tempWorkspace();
    const provider = new ContainerExecutionProvider({ runtime: "docker", workspaceRoot: workspace, runner: async () => assert.fail("runner should not execute") });
    await assert.rejects(() => provider.run({ command: "sh", args: ["-c", "id"], cwd: workspace }), /not allowlisted/i);
});

test("container provider rejects cwd escape outside the disposable workspace", async () => {
    const workspace = await tempWorkspace();
    const provider = new ContainerExecutionProvider({ runtime: "docker", workspaceRoot: workspace, runner: async () => assert.fail("runner should not execute") });
    await assert.rejects(() => provider.run({ command: "node", args: [], cwd: path.dirname(workspace) }), /escaped/i);
});

test("sandbox session keeps the original workspace unchanged until promotion", async () => {
    const workspace = await tempWorkspace();
    await fs.writeFile(path.join(workspace, "app.js"), "old\n", "utf8");
    const session = await createSandboxSession(workspace, { taskId: "isolation" });
    try {
        await fs.writeFile(path.join(session.workspace, "app.js"), "new\n", "utf8");
        assert.equal(await fs.readFile(path.join(workspace, "app.js"), "utf8"), "old\n");
        const promoted = await session.promote();
        assert.deepEqual(promoted, [{ path: "app.js", status: "modified" }]);
        assert.equal(await fs.readFile(path.join(workspace, "app.js"), "utf8"), "new\n");
    } finally {
        await session.close();
    }
});

test("sandbox promotion applies add/modify/delete while excluding runtime junk", async () => {
    const workspace = await tempWorkspace();
    await fs.writeFile(path.join(workspace, "keep.txt"), "before", "utf8");
    await fs.writeFile(path.join(workspace, "delete.txt"), "bye", "utf8");
    const session = await createSandboxSession(workspace, { taskId: "promote" });
    try {
        await fs.writeFile(path.join(session.workspace, "keep.txt"), "after", "utf8");
        await fs.rm(path.join(session.workspace, "delete.txt"));
        await fs.writeFile(path.join(session.workspace, "added.txt"), "new", "utf8");
        await fs.mkdir(path.join(session.workspace, "node_modules", "junk"), { recursive: true });
        await fs.writeFile(path.join(session.workspace, "node_modules", "junk", "x"), "x");
        const promoted = await session.promote();
        assert.deepEqual(promoted.map((x) => x.path).sort(), ["added.txt", "delete.txt", "keep.txt"]);
        await assert.rejects(fs.access(path.join(workspace, "delete.txt")));
        await assert.rejects(fs.access(path.join(workspace, "node_modules", "junk", "x")));
    } finally {
        await session.close();
    }
});

test("sandbox artifacts can be copied out without promoting source changes", async () => {
    const workspace = await tempWorkspace();
    await fs.writeFile(path.join(workspace, "app.js"), "host", "utf8");
    const session = await createSandboxSession(workspace, { taskId: "artifact-task" });
    try {
        await fs.writeFile(path.join(session.workspace, "app.js"), "sandbox-only", "utf8");
        await fs.mkdir(path.join(session.workspace, "dist"), { recursive: true });
        await fs.writeFile(path.join(session.workspace, "dist", "result.txt"), "artifact", "utf8");
        const exported = await session.exportArtifacts(["dist/result.txt"]);
        assert.equal(exported.length, 1);
        assert.equal(await fs.readFile(path.join(workspace, "app.js"), "utf8"), "host");
        assert.equal(await fs.readFile(path.join(workspace, ".forgepilot", "artifacts", "artifact-task", "dist", "result.txt"), "utf8"), "artifact");
    } finally {
        await session.close();
    }
});

test("orchestration routes both action and verification commands through the execution provider", async () => {
    const workspace = await tempWorkspace();
    const calls = [];
    const executionProvider = {
        kind: "fake-container",
        async run(spec) {
            calls.push({ command: spec.command, args: spec.args });
            return { command: spec.command, args: spec.args, exitCode: 0, stdout: "sandbox-ok\n", stderr: "", timedOut: false, durationMs: 1 };
        }
    };
    const task = {
        goal: "prove provider routing",
        actions: [{ type: "run_command", command: "node", args: ["action.js"], expectExitCode: 0 }],
        verify: [{ type: "command", command: "node", args: ["verify.js"], expectExitCode: 0, stdoutIncludes: "sandbox-ok" }]
    };
    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId: "provider-routing",
        executionProvider
    });
    assert.equal(result.verification.passed, true);
    assert.deepEqual(calls, [
        { command: "node", args: ["action.js"] },
        { command: "node", args: ["verify.js"] }
    ]);
});

test("sandbox visual evidence exports to the host evidence path without source promotion", async () => {
    const workspace = await tempWorkspace();
    const session = await createSandboxSession(workspace, { taskId: "visual-evidence-task" });
    try {
        const relative = ".forgepilot/visual/visual-evidence-task/screen.png";
        const source = path.join(session.workspace, ...relative.split("/"));
        await fs.mkdir(path.dirname(source), { recursive: true });
        await fs.writeFile(source, Buffer.from([1, 2, 3, 4]));
        const exported = await session.exportEvidence([relative, "dist/not-visual.txt"]);
        assert.equal(exported.length, 1);
        const hostEvidence = path.join(workspace, ...relative.split("/"));
        assert.deepEqual(await fs.readFile(hostEvidence), Buffer.from([1, 2, 3, 4]));
        await assert.rejects(fs.access(path.join(workspace, "dist", "not-visual.txt")));
    } finally {
        await session.close();
    }
});
