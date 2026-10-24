import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createWorkspaceCheckpoint, finalizeWorkspaceCheckpoint, rollbackWorkspaceCheckpoint } from "../src/repository/checkpoint.js";
import { buildPreflight } from "../src/repository/preflight.js";
import { DashboardJobManager } from "../src/dashboard/jobs.js";
import { createDashboardServer } from "../src/dashboard/server.js";

async function tempDir(prefix = "fp013-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function waitFor(manager, id, predicate, timeoutMs = 2000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = manager.get(id);
        if (predicate(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for v0.13 job.");
}

function modifyingSpawner(modify) {
    return (_command, _args, options) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => { child.emit("close", 143); return true; };
        setTimeout(async () => {
            try {
                await modify(options.cwd);
                child.stdout.write("Result: PASS\n");
            } catch (error) {
                child.stderr.write(error.message + "\n");
            }
            child.stdout.end(); child.stderr.end(); child.emit("close", 0);
        }, 10);
        return child;
    };
}

test("workspace checkpoint restores modified, added, and deleted files", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "keep.txt"), "before\n");
    await fs.writeFile(path.join(workspace, "delete.txt"), "present\n");
    await createWorkspaceCheckpoint(workspace, "demo");
    await fs.writeFile(path.join(workspace, "keep.txt"), "after\n");
    await fs.writeFile(path.join(workspace, "added.txt"), "new\n");
    await fs.rm(path.join(workspace, "delete.txt"));
    const finalized = await finalizeWorkspaceCheckpoint(workspace, "demo");
    assert.deepEqual(finalized.changes.map((x) => [x.path, x.status]), [["added.txt", "added"], ["delete.txt", "deleted"], ["keep.txt", "modified"]]);
    const rollback = await rollbackWorkspaceCheckpoint(workspace, "demo");
    assert.equal(rollback.passed, true);
    assert.equal(await fs.readFile(path.join(workspace, "keep.txt"), "utf8"), "before\n");
    assert.equal(await fs.readFile(path.join(workspace, "delete.txt"), "utf8"), "present\n");
    await assert.rejects(fs.stat(path.join(workspace, "added.txt")), /ENOENT/);
});

test("rollback restores the pre-job dirty state rather than Git HEAD", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "app.js"), "dirty user state\n");
    await createWorkspaceCheckpoint(workspace, "dirty");
    await fs.writeFile(path.join(workspace, "app.js"), "forgepilot state\n");
    await finalizeWorkspaceCheckpoint(workspace, "dirty");
    const rollback = await rollbackWorkspaceCheckpoint(workspace, "dirty");
    assert.equal(rollback.passed, true);
    assert.equal(await fs.readFile(path.join(workspace, "app.js"), "utf8"), "dirty user state\n");
});

test("rollback refuses to overwrite a file edited after ForgePilot completed", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "app.js"), "before\n");
    await createWorkspaceCheckpoint(workspace, "conflict");
    await fs.writeFile(path.join(workspace, "app.js"), "forgepilot\n");
    await finalizeWorkspaceCheckpoint(workspace, "conflict");
    await fs.writeFile(path.join(workspace, "app.js"), "newer human edit\n");
    const rollback = await rollbackWorkspaceCheckpoint(workspace, "conflict");
    assert.equal(rollback.passed, false);
    assert.deepEqual(rollback.conflicts.map((x) => x.path), ["app.js"]);
    assert.equal(await fs.readFile(path.join(workspace, "app.js"), "utf8"), "newer human edit\n");
});

test("dry-run rollback proves safety without modifying files", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "app.js"), "before\n");
    await createWorkspaceCheckpoint(workspace, "dry");
    await fs.writeFile(path.join(workspace, "app.js"), "after\n");
    await finalizeWorkspaceCheckpoint(workspace, "dry");
    const result = await rollbackWorkspaceCheckpoint(workspace, "dry", { dryRun: true });
    assert.equal(result.passed, true);
    assert.equal(result.dryRun, true);
    assert.equal(await fs.readFile(path.join(workspace, "app.js"), "utf8"), "after\n");
});

test("preflight identifies security/data migration work as high risk", async () => {
    const workspace = await tempDir();
    await fs.mkdir(path.join(workspace, "src", "auth"), { recursive: true });
    await fs.mkdir(path.join(workspace, "migrations"), { recursive: true });
    await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "risk-demo", scripts: { test: "node --test" } }));
    await fs.writeFile(path.join(workspace, "src", "auth", "session.js"), "export const x = 1;\n");
    await fs.writeFile(path.join(workspace, "migrations", "001.sql"), "select 1;\n");
    const result = await buildPreflight(workspace, { goal: "Migrate the authentication database schema and permissions" });
    assert.equal(result.risk.level, "high");
    assert.ok(result.risk.points >= 7);
    assert.equal(result.checkpointRecommended, true);
});

test("preflight reports existing dirty Git paths without exposing source contents", async () => {
    const workspace = await tempDir();
    const { spawnSync } = await import("node:child_process");
    spawnSync("git", ["init"], { cwd: workspace });
    await fs.writeFile(path.join(workspace, "README.md"), "baseline\n");
    spawnSync("git", ["add", "README.md"], { cwd: workspace });
    spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], { cwd: workspace });
    await fs.writeFile(path.join(workspace, "README.md"), "DIRTY SECRET CONTENT\n");
    const result = await buildPreflight(workspace, { goal: "Update documentation" });
    assert.equal(result.dirty.entries.includes("README.md"), true);
    assert.equal(JSON.stringify(result).includes("DIRTY SECRET CONTENT"), false);
});

test("dashboard jobs create checkpoints, summarize changes, and rollback safely", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "app.txt"), "before\n");
    const manager = new DashboardJobManager({ spawner: modifyingSpawner(async (cwd) => {
        await fs.writeFile(path.join(cwd, "app.txt"), "after\n");
        await fs.writeFile(path.join(cwd, "new.txt"), "new\n");
    }) });
    const created = await manager.create({ workspace, goal: "Update app" });
    const done = await waitFor(manager, created.id, (j) => ["pass", "fail"].includes(j.status));
    assert.equal(done.status, "pass");
    assert.equal(done.checkpoint.rollbackAvailable, true);
    assert.deepEqual(done.changeSet.summary, { added: 1, modified: 1, deleted: 0 });
    const preview = await manager.rollbackJob(created.id, { dryRun: true });
    assert.equal(preview.passed, true);
    const rollback = await manager.rollbackJob(created.id);
    assert.equal(rollback.passed, true);
    assert.equal(await fs.readFile(path.join(workspace, "app.txt"), "utf8"), "before\n");
    await assert.rejects(fs.stat(path.join(workspace, "new.txt")), /ENOENT/);
});

test("dashboard rollback API requires token and blocks post-run edit conflicts", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "app.txt"), "before\n");
    const manager = new DashboardJobManager({ spawner: modifyingSpawner(async (cwd) => fs.writeFile(path.join(cwd, "app.txt"), "after\n")) });
    const dashboard = await createDashboardServer({ workspace, port: 0, jobManager: manager });
    try {
        const headers = { "content-type": "application/json", "x-forgepilot-token": dashboard.controlToken };
        const createdResponse = await fetch(`http://${dashboard.host}:${dashboard.port}/api/jobs`, { method: "POST", headers, body: JSON.stringify({ workspace, goal: "update" }) });
        const created = await createdResponse.json();
        await waitFor(manager, created.id, (j) => ["pass", "fail"].includes(j.status));
        await fs.writeFile(path.join(workspace, "app.txt"), "human after run\n");
        const denied = await fetch(`http://${dashboard.host}:${dashboard.port}/api/jobs/${created.id}/rollback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }) });
        assert.equal(denied.status, 403);
        const conflict = await fetch(`http://${dashboard.host}:${dashboard.port}/api/jobs/${created.id}/rollback`, { method: "POST", headers, body: JSON.stringify({ dryRun: true }) });
        assert.equal(conflict.status, 200);
        const body = await conflict.json();
        assert.equal(body.passed, false);
        assert.deepEqual(body.conflicts.map((x) => x.path), ["app.txt"]);
    } finally { await new Promise((resolve) => dashboard.server.close(resolve)); }
});

test("checkpoint fails closed when repository scanning is truncated", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "a.txt"), "a\n");
    await fs.writeFile(path.join(workspace, "b.txt"), "b\n");
    await assert.rejects(createWorkspaceCheckpoint(workspace, "truncated", { maxFiles: 1 }), /scan exceeded 1 files/);
});

test("checkpoint fails closed when snapshot byte budget is exceeded", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "large.txt"), "0123456789\n");
    await assert.rejects(createWorkspaceCheckpoint(workspace, "oversize", { maxTotalBytes: 4 }), /snapshot exceeds 4 bytes/);
});
