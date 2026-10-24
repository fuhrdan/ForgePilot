import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DashboardJobManager } from "../src/dashboard/jobs.js";
import { createDashboardServer } from "../src/dashboard/server.js";

async function tempDir(prefix = "fp011-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

function fakeSpawner({ stdout = "Result: PASS\n", stderr = "", exitCode = 0, delay = 5 } = {}) {
    return (_command, _args, _options) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => { setTimeout(() => child.emit("close", 143), 0); return true; };
        setTimeout(() => {
            if (stdout) child.stdout.write(stdout);
            if (stderr) child.stderr.write(stderr);
            child.stdout.end(); child.stderr.end();
            child.emit("close", exitCode);
        }, delay);
        return child;
    };
}

async function waitFor(manager, id, predicate, timeoutMs = 1000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = manager.get(id);
        if (predicate(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for dashboard job.");
}

test("dashboard repository analysis returns metadata without source excerpts", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "node --test" } }));
    await fs.writeFile(path.join(workspace, "secret-source.js"), "const TOP_SECRET_SOURCE = 'do-not-return-me';\n");
    const manager = new DashboardJobManager({ machineConfig: { maxContextTokens: 1200 } });
    const result = await manager.analyze({ workspace, goal: "test demo" });
    assert.equal(result.projects[0].ecosystem, "node");
    assert.equal(JSON.stringify(result).includes("do-not-return-me"), false);
    assert.ok(Array.isArray(result.selectedFiles));
});

test("dashboard-created tasks require all sensitive categories and grant only explicit approvals", async () => {
    const workspace = await tempDir();
    const manager = new DashboardJobManager({
        machineConfig: { model: "tiny-model", maxContextTokens: 1024, maxRepairs: 1, maxReviewRounds: 0, agentTeamEnabled: false },
        spawner: fakeSpawner()
    });
    const job = await manager.create({ workspace, goal: "Create a tiny file", autonomy: "safe", approvals: ["file_write", "command_exec"] });
    const task = JSON.parse(await fs.readFile(job.taskPath, "utf8"));
    assert.deepEqual(task.permissions.require.sort(), ["command_exec", "computer_control", "external_network", "file_write", "sandbox_network", "secret_use"].sort());
    assert.equal(task.agentTeam.enabled, false);
    assert.equal(task.maxRepairs, 1);
    assert.deepEqual(job.approvals.sort(), ["command_exec", "file_write"]);
    await waitFor(manager, job.id, (j) => j.status !== "running");
});

test("dashboard job runner uses argv arrays and surfaces live phase evidence", async () => {
    const workspace = await tempDir();
    let captured = null;
    const spawner = (command, args, options) => {
        captured = { command, args, options };
        return fakeSpawner({ stdout: "Plan rationale: demo\nActions: 2; verification checks: 1\nResult: PASS\n" })(command, args, options);
    };
    const manager = new DashboardJobManager({ nodePath: "node-test", cliPath: "cli-test.js", spawner });
    const job = await manager.create({ workspace, goal: "Goal with spaces & metacharacters", approvals: ["file_write", "command_exec"] });
    const done = await waitFor(manager, job.id, (j) => ["pass", "fail"].includes(j.status));
    assert.equal(captured.command, "node-test");
    assert.equal(captured.options.shell, false);
    assert.equal(captured.args[0], "cli-test.js");
    assert.ok(captured.args.includes(job.taskPath));
    assert.equal(done.status, "pass");
    assert.equal(done.phase, "completed");
    assert.match(done.log, /Plan rationale/);
});

test("dashboard rejects unknown approvals instead of forwarding them", async () => {
    const workspace = await tempDir();
    const manager = new DashboardJobManager({ spawner: fakeSpawner() });
    const job = await manager.create({ workspace, goal: "demo", approvals: ["file_write", "root_shell", "command_exec"] });
    assert.deepEqual(job.approvals.sort(), ["command_exec", "file_write"]);
    await waitFor(manager, job.id, (j) => j.status !== "running");
});

test("dashboard report reader refuses paths outside the job workspace", async () => {
    const workspace = await tempDir();
    const outside = await tempDir("fp011-outside-");
    const manager = new DashboardJobManager({ spawner: fakeSpawner() });
    const job = await manager.create({ workspace, goal: "demo" });
    await waitFor(manager, job.id, (j) => j.status !== "running");
    const internal = manager.jobs.get(job.id);
    internal.reportPath = path.join(outside, "report.json");
    await fs.writeFile(internal.reportPath, "{}\n");
    await assert.rejects(manager.report(job.id), /outside the job workspace/);
});

test("dashboard control API requires per-launch token for mutation requests", async () => {
    const workspace = await tempDir();
    const manager = new DashboardJobManager({ spawner: fakeSpawner() });
    const dashboard = await createDashboardServer({ workspace, port: 0, jobManager: manager });
    try {
        const base = `http://${dashboard.host}:${dashboard.port}`;
        const denied = await fetch(`${base}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace, goal: "demo" }) });
        assert.equal(denied.status, 403);
        const allowed = await fetch(`${base}/api/analyze`, { method: "POST", headers: { "content-type": "application/json", "x-forgepilot-token": dashboard.controlToken }, body: JSON.stringify({ workspace, goal: "demo" }) });
        assert.equal(allowed.status, 200);
    } finally { await new Promise((resolve) => dashboard.server.close(resolve)); }
});

test("dashboard API starts jobs with explicit grants and exposes status", async () => {
    const workspace = await tempDir();
    const manager = new DashboardJobManager({ spawner: fakeSpawner({ stdout: "Result: PASS\n", delay: 20 }) });
    const dashboard = await createDashboardServer({ workspace, port: 0, jobManager: manager });
    try {
        const base = `http://${dashboard.host}:${dashboard.port}`;
        const response = await fetch(`${base}/api/jobs`, { method: "POST", headers: { "content-type": "application/json", "x-forgepilot-token": dashboard.controlToken }, body: JSON.stringify({ workspace, goal: "UI job", autonomy: "standard", approvals: ["file_write", "command_exec"] }) });
        assert.equal(response.status, 202);
        const created = await response.json();
        const done = await waitFor(manager, created.id, (j) => ["pass", "fail"].includes(j.status));
        const status = await fetch(`${base}/api/jobs/${created.id}`);
        assert.equal(status.status, 200);
        assert.equal((await status.json()).status, done.status);
    } finally { await new Promise((resolve) => dashboard.server.close(resolve)); }
});

test("dashboard exposes a stricter CSP and does not frame the local control center", async () => {
    const workspace = await tempDir();
    const dashboard = await createDashboardServer({ workspace, port: 0, jobManager: new DashboardJobManager({ spawner: fakeSpawner() }) });
    try {
        const response = await fetch(`http://${dashboard.host}:${dashboard.port}/`);
        assert.equal(response.headers.get("x-frame-options"), "DENY");
        assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
        assert.match(await response.text(), /Start verified job/);
    } finally { await new Promise((resolve) => dashboard.server.close(resolve)); }
});

test("dashboard distinguishes signed JSON report from human-readable Markdown report", async () => {
    const manager = new DashboardJobManager();
    const job = { log: "", phase: "running", reportPath: null, markdownPath: null };
    manager.append(job, "Report: C:\\work\\report.md\nJSON: C:\\work\\report.json\nResult: PASS\n");
    assert.equal(job.markdownPath, "C:\\work\\report.md");
    assert.equal(job.reportPath, "C:\\work\\report.json");
    assert.equal(job.phase, "completed");
});
