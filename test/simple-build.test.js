import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { createSimpleBuildWorkspace, buildSimpleTask, SIMPLE_BUILD_DEFAULTS, slugifyProjectName } from "../src/product/simple-build.js";
import { OllamaPlanner } from "../src/planners/ollama.js";
import { DashboardJobManager } from "../src/dashboard/jobs.js";
import { createDashboardServer } from "../src/dashboard/server.js";

async function tempDir(prefix = "fp016-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

function hangingSpawner() {
    return () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => { setTimeout(() => child.emit("close", 137), 0); return true; };
        return child;
    };
}

function passSpawner(delay = 120) {
    return () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => { setTimeout(() => child.emit("close", 143), 0); return true; };
        setTimeout(() => {
            child.stdout.write("Progress: Generating implementation plan\nPlan rationale: demo\nActions: 1; verification checks: 1\nResult: PASS\n");
            child.stdout.end(); child.stderr.end(); child.emit("close", 0);
        }, delay);
        return child;
    };
}

async function waitFor(manager, id, predicate, timeoutMs = 1500) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = manager.get(id);
        if (predicate(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for simple build job.");
}

test("simple build slug and automatic project allocation are safe and collision-free", async () => {
    const root = await tempDir();
    assert.equal(slugifyProjectName(" CPU / RAM Monitor! "), "cpu-ram-monitor");
    const first = await createSimpleBuildWorkspace(root, { description: "Build a CPU RAM Monitor" });
    const second = await createSimpleBuildWorkspace(root, { description: "Build a CPU RAM Monitor" });
    assert.equal(first.created, true);
    assert.equal(second.created, true);
    assert.notEqual(first.workspace, second.workspace);
    assert.match(first.workspace, /Projects/);
});

test("simple build task disables multi-agent overhead and carries bounded watchdogs", () => {
    const task = buildSimpleTask({ description: "Build a tiny Java app", machineConfig: { model: "qwen2.5-coder:3b", modelFallbacks: ["qwen2.5-coder:1.5b"], maxRepairs: 3, agentTeamEnabled: true } });
    assert.equal(task.simpleBuild, true);
    assert.equal(task.agentTeam.enabled, false);
    assert.equal(task.maxRepairs, 2);
    assert.equal(task.watchdog.modelTimeoutMs, SIMPLE_BUILD_DEFAULTS.modelTimeoutMs);
    assert.equal(task.watchdog.noProgressTimeoutMs, SIMPLE_BUILD_DEFAULTS.noProgressTimeoutMs);
    assert.equal(task.watchdog.overallTimeoutMs, SIMPLE_BUILD_DEFAULTS.overallTimeoutMs);
    assert.deepEqual(task.permissions.require.sort(), ["command_exec", "computer_control", "external_network", "file_write", "sandbox_network", "secret_use"].sort());
});

test("Ollama planner aborts a stalled model and falls back to the next model", async () => {
    const seen = [];
    const server = http.createServer(async (req, res) => {
        if (req.url !== "/api/generate") { res.writeHead(404); return res.end(); }
        let body = "";
        for await (const chunk of req) body += chunk;
        const model = JSON.parse(body).model;
        seen.push(model);
        if (model === "slow-model") { req.on("aborted", () => res.destroy()); return; } // deliberately never answer; request abort must release the caller
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ response: JSON.stringify({ goal: "demo", rationale: "fallback", actions: [], verify: [] }) }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const events = [];
    try {
        const planner = new OllamaPlanner({ model: "slow-model", fallbackModels: ["small-model"], baseUrl: `http://127.0.0.1:${port}`, generationTimeoutMs: 250, progressIntervalMs: 50, onProgress: (e) => events.push(e) });
        const result = await planner.plan({ goal: "demo" }, { files: [], git: { isRepository: false } });
        assert.equal(result.rationale, "fallback");
        assert.deepEqual(seen, ["slow-model", "small-model"]);
        assert.ok(events.some((e) => e.phase === "model_fallback"));
    } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
});

test("dashboard simple build creates a project and starts with only local build grants", async () => {
    const root = await tempDir();
    const manager = new DashboardJobManager({ rootWorkspace: root, spawner: passSpawner(), machineConfig: { model: "tiny", maxRepairs: 1, adaptiveRuntime: false } });
    const job = await manager.createSimple({ description: "Build a hello world program", projectName: "hello" });
    assert.equal(job.simpleBuild, true);
    assert.equal(job.autonomy, "simple");
    assert.deepEqual(job.approvals.sort(), ["command_exec", "file_write"]);
    assert.match(job.workspace, /Projects[\\/]hello/);
    const task = JSON.parse(await fs.readFile(job.taskPath, "utf8"));
    assert.equal(task.agentTeam.enabled, false);
    await waitFor(manager, job.id, (j) => ["pass", "fail"].includes(j.status));
});

test("dashboard watchdog stops a silent child instead of allowing an indefinite run", async () => {
    const root = await tempDir();
    const manager = new DashboardJobManager({ rootWorkspace: root, spawner: hangingSpawner(), machineConfig: { model: "tiny", adaptiveRuntime: false }, watchdogFloorMs: 30, watchdogPollMs: 5 });
    await manager.setQueuePaused(true);
    const job = await manager.createSimple({ description: "Build something that would otherwise stall", projectName: "stall" });
    const task = JSON.parse(await fs.readFile(job.taskPath, "utf8"));
    task.watchdog.noProgressTimeoutMs = 35;
    task.watchdog.overallTimeoutMs = 200;
    await fs.writeFile(job.taskPath, JSON.stringify(task, null, 2));
    await manager.setQueuePaused(false);
    const done = await waitFor(manager, job.id, (j) => j.status === "fail", 1000);
    assert.equal(done.phase, "watchdog_stopped");
    assert.match(done.error, /No useful process output/);
    assert.match(done.log, /WATCHDOG STOP/);
});

test("progress output updates a simple job to a visible generating phase", () => {
    const manager = new DashboardJobManager();
    const job = { log: "", phase: "starting", lastActivityAt: null };
    manager.append(job, "Progress: Waiting for qwen2.5-coder:3b (30s / 120s max)\n");
    assert.equal(job.phase, "generating");
    assert.ok(job.lastActivityAt);
});

test("dashboard exposes the Just Build It form and token-protected build endpoint", async () => {
    const root = await tempDir();
    const manager = new DashboardJobManager({ rootWorkspace: root, spawner: passSpawner(), machineConfig: { model: "tiny", adaptiveRuntime: false } });
    const dashboard = await createDashboardServer({ workspace: root, port: 0, jobManager: manager });
    try {
        const base = `http://${dashboard.host}:${dashboard.port}`;
        const page = await fetch(`${base}/`);
        const html = await page.text();
        assert.match(html, /What do you want ForgePilot to build/);
        assert.match(html, />BUILD IT</);
        const denied = await fetch(`${base}/api/build`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: "Build a tiny app" }) });
        assert.equal(denied.status, 403);
        const allowed = await fetch(`${base}/api/build`, { method: "POST", headers: { "content-type": "application/json", "x-forgepilot-token": dashboard.controlToken }, body: JSON.stringify({ description: "Build a tiny app", projectName: "tiny-app" }) });
        assert.equal(allowed.status, 202);
        assert.equal((await allowed.json()).simpleBuild, true);
    } finally { await new Promise((resolve) => dashboard.server.close(resolve)); }
});


test("CLI build works on first run even when no machine profile exists", async () => {
    const root = await tempDir("fp016-cli-");
    const home = await tempDir("fp016-home-");
    const server = http.createServer(async (req, res) => {
        if (req.url !== "/api/generate") { res.writeHead(404); return res.end(); }
        for await (const _chunk of req) { /* consume */ }
        const plan = { goal: "demo", rationale: "first-run", actions: [{ type: "write_file", path: "main.js", content: "console.log('FIRST_RUN_OK');\n" }], verify: [{ type: "file_contains", path: "main.js", text: "FIRST_RUN_OK" }] };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ response: JSON.stringify(plan) }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        const child = spawn(process.execPath, [path.resolve("src/cli.js"), "build", "Build a tiny first-run app", "--project-name", "first-run", "--model", "tiny", "--ollama-url", `http://127.0.0.1:${port}`], { cwd: path.resolve("."), env: { ...process.env, HOME: home, USERPROFILE: home, FORGEPILOT_WORKSPACE: root }, shell: false });
        let stdout = "", stderr = "";
        child.stdout.on("data", (c) => { stdout += c; });
        child.stderr.on("data", (c) => { stderr += c; });
        const code = await new Promise((resolve) => child.on("close", resolve));
        assert.equal(code, 0, stderr);
        assert.match(stdout, /Result: PASS/);
        assert.equal(await fs.readFile(path.join(root, "Projects", "first-run", "main.js"), "utf8"), "console.log('FIRST_RUN_OK');\n");
    } finally { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
});
