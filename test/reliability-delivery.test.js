import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finalizeDeliverable } from "../src/product/deliverables.js";
import { createDiagnosticBundle } from "../src/product/diagnostics.js";
import { diagnoseFailure } from "../src/product/failure-diagnosis.js";
import { benchmarkOllamaModels } from "../src/product/model-benchmark.js";
import { checkForUpdate } from "../src/product/maintenance.js";
import { writeZip } from "../src/product/zip.js";

async function temp(name) { return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`)); }

test("zip writer creates a standards-shaped archive with named entries", async () => {
    const dir = await temp("fp-zip");
    const out = path.join(dir, "x.zip");
    await writeZip(out, [{ name: "hello.txt", data: "HELLO" }]);
    const data = await fs.readFile(out);
    assert.equal(data.subarray(0, 4).toString("hex"), "504b0304");
    assert.ok(data.includes(Buffer.from("hello.txt")));
    assert.ok(data.includes(Buffer.from("HELLO")));
});

test("finished deliverable prefers built artifacts and also creates a source bundle", async () => {
    const dir = await temp("fp-delivery");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "demo-app", main: "app.js" }));
    await fs.writeFile(path.join(dir, "app.js"), "console.log('ok');\n");
    await fs.mkdir(path.join(dir, "dist"));
    await fs.writeFile(path.join(dir, "dist", "demo.exe"), Buffer.from([1,2,3,4]));
    const result = await finalizeDeliverable(dir, { taskId: "t1" });
    assert.equal(result.primary.kind, "built-artifact");
    assert.equal(path.basename(result.primary.path), "demo.exe");
    const bundle = result.artifacts.find((item) => item.kind === "source-bundle");
    assert.ok(bundle);
    const zip = await fs.readFile(bundle.path);
    assert.ok(zip.includes(Buffer.from("RUN.cmd")));
    assert.ok(zip.includes(Buffer.from("app.js")));
});

test("diagnostic bundle excludes prompts, secrets, and repository filenames", async () => {
    const dir = await temp("fp-diag");
    await fs.writeFile(path.join(dir, "VERY_PRIVATE_SOURCE_NAME.js"), "const secret='TOP_SECRET_VALUE';\n");
    const bundle = await createDiagnosticBundle(dir, { version: "0.19.0" });
    const bytes = await fs.readFile(bundle.path);
    assert.equal(bytes.includes(Buffer.from("TOP_SECRET_VALUE")), false);
    assert.equal(bytes.includes(Buffer.from("VERY_PRIVATE_SOURCE_NAME")), false);
    assert.ok(bytes.includes(Buffer.from("sourceCodeIncluded")));
});

test("failure diagnosis gives actionable watchdog and toolchain messages", () => {
    assert.equal(diagnoseFailure({ log: "WATCHDOG STOP: No useful process output" }).code, "no-progress");
    assert.equal(diagnoseFailure({ error: "spawn javac ENOENT" }).code, "jdk-missing");
    assert.equal(diagnoseFailure({ error: "model requires more memory" }).automaticFixAvailable, true);
});

test("model benchmark recommends the fastest passing installed model", async () => {
    const delays = new Map([["qwen2.5-coder:1.5b", 20], ["qwen2.5-coder:3b", 5]]);
    const fetchImpl = async (url, options = {}) => {
        if (url.endsWith("/api/tags")) return { ok: true, status: 200, json: async () => ({ models: [...delays.keys()].map((name) => ({ name })) }) };
        const body = JSON.parse(options.body);
        await new Promise((r) => setTimeout(r, delays.get(body.model)));
        return { ok: true, status: 200, json: async () => ({ response: "FORGEPILOT_BENCH_OK", eval_count: 10, eval_duration: 1_000_000_000 }) };
    };
    const result = await benchmarkOllamaModels({ fetchImpl, timeoutMs: 1000, maxModels: 2 });
    assert.equal(result.recommended, "qwen2.5-coder:3b");
    assert.equal(result.results.length, 2);
});

test("update checker compares GitHub release tags and exposes Windows asset", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ tag_name: "v0.20.0", html_url: "https://example/release", assets: [{ name: "ForgePilot-v0.20.0-windows.zip", browser_download_url: "https://example/file", size: 123 }] }) });
    const result = await checkForUpdate({ currentVersion: "0.19.0", fetchImpl });
    assert.equal(result.updateAvailable, true);
    assert.equal(result.latestVersion, "0.20.0");
    assert.equal(result.asset.name, "ForgePilot-v0.20.0-windows.zip");
});

import { DashboardJobManager } from "../src/dashboard/jobs.js";
import { saveState } from "../src/core/state.js";

test("interrupted dashboard retry becomes a core resume when task state exists", async () => {
    const root = await temp("fp-resume");
    const manager = new DashboardJobManager({ rootWorkspace: root, machineConfig: { adaptiveRuntime: false } });
    await manager.initialize();
    await manager.setQueuePaused(true);
    const job = await manager.createUniversal({ prompt: "Build a tiny Node app" });
    const live = manager.jobs.get(job.id);
    live.status = "interrupted";
    live.phase = "interrupted";
    await saveState(live.workspace, { taskId: live.taskId, status: "failed", actionIndex: 0, actions: [], repairs: [], repairCount: 0 });
    const resumed = await manager.retry(job.id);
    assert.equal(resumed.resume, true);
    assert.equal(resumed.retryOf, job.id);
    assert.equal(resumed.taskPath, job.taskPath);
    assert.equal(resumed.workspace, job.workspace);
});
