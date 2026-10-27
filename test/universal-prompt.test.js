import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { classifyUniversalIntent, findWorkspaceInPrompt, resolveUniversalWorkspace, buildUniversalTask } from "../src/product/universal-prompt.js";
import { DashboardJobManager } from "../src/dashboard/jobs.js";
import { createDashboardServer } from "../src/dashboard/server.js";

async function tempDir(prefix = "fp017-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

function passSpawner() {
    return () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
        setTimeout(() => {
            child.stdout.write("Progress: Generating implementation plan\nPlan rationale: universal\nActions: 1; verification checks: 1\nResult: PASS\n");
            child.stdout.end(); child.stderr.end(); child.emit("close", 0);
        }, 30);
        return child;
    };
}

async function waitFor(manager, id, predicate, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const value = manager.get(id);
        if (predicate(value)) return value;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Timed out waiting for universal prompt job.");
}

test("universal prompt infers safe capability sets from natural language", () => {
    assert.deepEqual(classifyUniversalIntent("Review /tmp/repo for reliability problems").approvals, []);
    assert.deepEqual(classifyUniversalIntent("Run tests in /tmp/repo").approvals, ["command_exec"]);
    assert.deepEqual(classifyUniversalIntent("Fix the login bug in /tmp/repo").approvals, ["file_write", "command_exec"]);
    const ui = classifyUniversalIntent("Open the browser UI and click through my localhost app");
    assert.ok(ui.approvals.includes("computer_control"));
    const net = classifyUniversalIntent("Download the schema from https://example.com and update the app");
    assert.ok(net.approvals.includes("external_network"));
});

test("universal prompt finds an existing workspace embedded directly in prose", async () => {
    const repo = await tempDir();
    const found = await findWorkspaceInPrompt(`Fix the retry bug in ${repo} and add a test.`);
    assert.equal(found, path.resolve(repo));
});

test("universal prompt creates a project when no existing path is supplied", async () => {
    const root = await tempDir();
    const resolved = await resolveUniversalWorkspace(root, "Build a tiny Java desktop clock");
    assert.equal(resolved.created, true);
    assert.match(resolved.workspace, /Projects/);
});

test("universal task keeps one-agent low-resource watchdog behavior and fails closed on ungranted capabilities", () => {
    const intent = classifyUniversalIntent("Fix a bug in the local project");
    const task = buildUniversalTask({ prompt: "Fix a bug in the local project", machineConfig: { model: "tiny" }, intent });
    assert.equal(task.universalPrompt, true);
    assert.equal(task.agentTeam.enabled, false);
    assert.deepEqual(task.permissions.require.sort(), ["command_exec", "computer_control", "external_network", "file_write", "sandbox_network", "secret_use"].sort());
    assert.equal(task.metadata.inferredIntent, "build");
});

test("dashboard universal prompt uses an embedded existing project path instead of creating a second project", async () => {
    const root = await tempDir();
    const repo = await tempDir("fp017-repo-");
    const manager = new DashboardJobManager({ rootWorkspace: root, spawner: passSpawner(), machineConfig: { model: "tiny", adaptiveRuntime: false } });
    const job = await manager.createUniversal({ prompt: `Fix the retry bug in ${repo} and add a regression test.` });
    assert.equal(job.workspace, path.resolve(repo));
    assert.equal(job.universalPrompt, true);
    assert.deepEqual(job.approvals.sort(), ["command_exec", "file_write"]);
    const done = await waitFor(manager, job.id, (j) => ["pass", "fail"].includes(j.status));
    assert.equal(done.status, "pass");
});

test("dashboard is one visible prompt and token-protected universal endpoint", async () => {
    const root = await tempDir();
    const manager = new DashboardJobManager({ rootWorkspace: root, spawner: passSpawner(), machineConfig: { model: "tiny", adaptiveRuntime: false } });
    const dashboard = await createDashboardServer({ workspace: root, port: 0, jobManager: manager });
    try {
        const base = `http://${dashboard.host}:${dashboard.port}`;
        const html = await (await fetch(`${base}/`)).text();
        assert.match(html, /One prompt/);
        assert.match(html, /id="prompt"/);
        assert.match(html, />DO IT</);
        assert.doesNotMatch(html, /Project name <span/);
        assert.doesNotMatch(html, /Use an existing project <span/);
        const denied = await fetch(`${base}/api/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Build a tiny app" }) });
        assert.equal(denied.status, 403);
        const allowed = await fetch(`${base}/api/prompt`, { method: "POST", headers: { "content-type": "application/json", "x-forgepilot-token": dashboard.controlToken }, body: JSON.stringify({ prompt: "Build a tiny app" }) });
        assert.equal(allowed.status, 202);
        const job = await allowed.json();
        assert.equal(job.universalPrompt, true);
    } finally { await new Promise((resolve) => dashboard.server.close(resolve)); }
});

test("universal retry stays in the same workspace", async () => {
    const root = await tempDir();
    const manager = new DashboardJobManager({ rootWorkspace: root, spawner: passSpawner(), machineConfig: { model: "tiny", adaptiveRuntime: false } });
    const first = await manager.createUniversal({ prompt: "Build a tiny app" });
    await waitFor(manager, first.id, (j) => j.status === "pass");
    const retry = await manager.retry(first.id);
    assert.equal(retry.workspace, first.workspace);
    assert.equal(retry.retryOf, first.id);
});
