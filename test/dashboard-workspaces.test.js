import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DashboardJobManager } from "../src/dashboard/jobs.js";
import { DashboardProjectStore } from "../src/dashboard/projects.js";
import { DashboardRecipeStore, applyRecipe } from "../src/dashboard/recipes.js";
import { createDashboardServer } from "../src/dashboard/server.js";

async function tempDir(prefix = "fp012-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

function fakeSpawner({ stdout = "Result: PASS\n", exitCode = 0, delay = 5 } = {}) {
    return () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => { setTimeout(() => child.emit("close", 143), 0); return true; };
        setTimeout(() => { child.stdout.write(stdout); child.stdout.end(); child.stderr.end(); child.emit("close", exitCode); }, delay);
        return child;
    };
}

async function waitUntil(predicate, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for condition.");
}

test("project registry persists reusable repository defaults without modifying the repository", async () => {
    const root = await tempDir();
    const repo = await tempDir("fp012-repo-");
    const store = new DashboardProjectStore(root);
    const saved = await store.save({ name: "Ops Demo", path: repo, recipeId: "fix-bug-test-first", autonomy: "thorough", approvals: ["file_write", "command_exec"], sandbox: true });
    const reloaded = new DashboardProjectStore(root);
    const items = await reloaded.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, saved.id);
    assert.equal(items[0].path, path.resolve(repo));
    assert.equal(items[0].recipeId, "fix-bug-test-first");
    assert.equal(items[0].sandbox, true);
    assert.equal(await fs.stat(path.join(root, ".forgepilot", "dashboard", "projects.json")).then(() => true), true);
});

test("project registry rejects non-existent repository paths", async () => {
    const root = await tempDir();
    const store = new DashboardProjectStore(root);
    await assert.rejects(store.save({ name: "Missing", path: path.join(root, "does-not-exist") }), /not an existing directory/);
});

test("recipe store exposes built-ins and persists custom reusable workflows", async () => {
    const root = await tempDir();
    const store = new DashboardRecipeStore(root);
    const initial = await store.list();
    assert.ok(initial.some((item) => item.id === "fix-bug-test-first" && item.builtin));
    const custom = await store.save({ name: "Conservative refactor", prefix: "Refactor only the requested area.", suffix: "Run tests and keep public behavior stable.", autonomy: "safe", approvals: ["file_write", "command_exec"] });
    const reloaded = new DashboardRecipeStore(root);
    const loaded = await reloaded.get(custom.id);
    assert.equal(loaded.name, "Conservative refactor");
    assert.match(applyRecipe(loaded, "Clean up the parser."), /Clean up the parser/);
    assert.match(applyRecipe(loaded, "Clean up the parser."), /keep public behavior stable/i);
});

test("built-in recipes cannot be overwritten or deleted", async () => {
    const root = await tempDir();
    const store = new DashboardRecipeStore(root);
    await assert.rejects(store.save({ id: "fix-bug-test-first", name: "Hijack", prefix: "bad" }), /cannot be replaced/);
    await assert.rejects(store.remove("fix-bug-test-first"), /cannot be deleted/);
});

test("recipe-backed queued task expands the goal and inherits safe defaults", async () => {
    const root = await tempDir();
    const repo = await tempDir("fp012-recipe-repo-");
    const recipes = new DashboardRecipeStore(root);
    const manager = new DashboardJobManager({ rootWorkspace: root, recipeStore: recipes, spawner: fakeSpawner() });
    await manager.initialize();
    await manager.setQueuePaused(true);
    const job = await manager.create({ workspace: repo, goal: "Retry counter becomes negative.", recipeId: "fix-bug-test-first", autonomy: null, approvals: undefined });
    const task = JSON.parse(await fs.readFile(job.taskPath, "utf8"));
    assert.equal(job.status, "queued");
    assert.equal(job.recipeId, "fix-bug-test-first");
    assert.equal(job.autonomy, "standard");
    assert.deepEqual(job.approvals.sort(), ["command_exec", "file_write"]);
    assert.match(task.goal, /regression test first/i);
    assert.match(task.goal, /Retry counter becomes negative/);
});

test("FIFO queue runs only the configured number of jobs concurrently", async () => {
    const repo = await tempDir();
    const children = [];
    const spawner = () => {
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
        children.push(child);
        return child;
    };
    const manager = new DashboardJobManager({ spawner, maxConcurrentJobs: 1 });
    const first = await manager.create({ workspace: repo, goal: "first" });
    await waitUntil(() => children.length === 1);
    const second = await manager.create({ workspace: repo, goal: "second" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(children.length, 1);
    assert.equal(manager.get(first.id).status, "running");
    assert.equal(manager.get(second.id).status, "queued");
    children[0].stdout.write("Result: PASS\n"); children[0].stdout.end(); children[0].stderr.end(); children[0].emit("close", 0);
    await waitUntil(() => children.length === 2);
    assert.equal(manager.get(second.id).status, "running");
    children[1].stdout.write("Result: PASS\n"); children[1].stdout.end(); children[1].stderr.end(); children[1].emit("close", 0);
    await waitUntil(() => manager.get(second.id).status === "pass");
});

test("queued jobs can be paused, resumed, and cancelled without pretending to suspend a running process", async () => {
    const root = await tempDir();
    const manager = new DashboardJobManager({ rootWorkspace: root, spawner: fakeSpawner({ delay: 100 }) });
    await manager.initialize();
    await manager.setQueuePaused(true);
    const job = await manager.create({ workspace: root, goal: "queued work" });
    assert.equal(await manager.pause(job.id), true);
    assert.equal(manager.get(job.id).status, "paused");
    assert.equal(await manager.resume(job.id), true);
    assert.equal(manager.get(job.id).status, "queued");
    assert.equal(manager.cancel(job.id), true);
    assert.equal(manager.get(job.id).status, "cancelled");
});

test("finished jobs can be retried with an auditable retryOf link", async () => {
    const repo = await tempDir();
    const manager = new DashboardJobManager({ spawner: fakeSpawner() });
    const first = await manager.create({ workspace: repo, goal: "retry me" });
    await waitUntil(() => manager.get(first.id).status === "pass");
    const retry = await manager.retry(first.id);
    assert.ok(retry);
    assert.equal(retry.retryOf, first.id);
    await waitUntil(() => manager.get(retry.id).status === "pass");
});

test("persisted queue survives restart and stale running jobs become interrupted", async () => {
    const root = await tempDir();
    const manager = new DashboardJobManager({ rootWorkspace: root, spawner: fakeSpawner() });
    await manager.initialize();
    await manager.setQueuePaused(true);
    const queued = await manager.create({ workspace: root, goal: "persist me" });
    const restarted = new DashboardJobManager({ rootWorkspace: root, spawner: fakeSpawner() });
    await restarted.initialize();
    assert.equal(restarted.get(queued.id).status, "queued");
    const internal = restarted.jobs.get(queued.id);
    internal.status = "running"; internal.phase = "executing";
    await restarted.persist();
    const afterCrash = new DashboardJobManager({ rootWorkspace: root, spawner: fakeSpawner() });
    await afterCrash.initialize();
    assert.equal(afterCrash.get(queued.id).status, "interrupted");
    assert.match(afterCrash.get(queued.id).error, /stopped while this job was running/);
});

test("dashboard project, recipe, queue, and retry APIs require token on mutation and remain loopback-local", async () => {
    const root = await tempDir();
    const repo = await tempDir("fp012-api-repo-");
    const manager = new DashboardJobManager({ spawner: fakeSpawner() });
    const dashboard = await createDashboardServer({ workspace: root, port: 0, jobManager: manager });
    try {
        const base = `http://${dashboard.host}:${dashboard.port}`;
        const headers = { "content-type": "application/json", "x-forgepilot-token": dashboard.controlToken };
        const projectResponse = await fetch(`${base}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name: "API Project", path: repo }) });
        assert.equal(projectResponse.status, 200);
        const recipes = await fetch(`${base}/api/recipes`).then((r) => r.json());
        assert.ok(recipes.some((item) => item.id === "add-feature"));
        const pause = await fetch(`${base}/api/queue/pause`, { method: "POST", headers, body: "{}" });
        assert.equal(pause.status, 200);
        const createdResponse = await fetch(`${base}/api/jobs`, { method: "POST", headers, body: JSON.stringify({ workspace: repo, goal: "API queued", recipeId: "add-feature" }) });
        const created = await createdResponse.json();
        assert.equal(created.status, "queued");
        const denied = await fetch(`${base}/api/jobs/${created.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        assert.equal(denied.status, 403);
        const cancel = await fetch(`${base}/api/jobs/${created.id}/cancel`, { method: "POST", headers, body: "{}" });
        assert.equal(cancel.status, 200);
    } finally { await new Promise((resolve) => dashboard.server.close(resolve)); }
});
