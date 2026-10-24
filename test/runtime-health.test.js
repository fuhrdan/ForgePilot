import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { OllamaPlanner } from "../src/planners/ollama.js";
import { DashboardJobManager } from "../src/dashboard/jobs.js";
import { modelFallbacksFor, inspectOllama, selectInstalledModel, chooseConservativePlan, buildRuntimeHealth, runSelfTest } from "../src/product/runtime-health.js";

async function tempDir(prefix = "fp014-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function server(handler) {
    const value = http.createServer(handler);
    await new Promise((resolve) => value.listen(0, "127.0.0.1", resolve));
    return { server: value, url: `http://127.0.0.1:${value.address().port}` };
}

test("known coding models get a descending low-resource fallback chain", () => {
    assert.deepEqual(modelFallbacksFor("qwen2.5-coder:14b"), ["qwen2.5-coder:7b", "qwen2.5-coder:3b", "qwen2.5-coder:1.5b"]);
    assert.deepEqual(modelFallbacksFor("qwen2.5-coder:1.5b"), []);
});

test("Ollama health probe lists locally installed models without external network access", async () => {
    const api = await server((req, res) => {
        assert.equal(req.url, "/api/tags");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "qwen2.5-coder:3b" }, { model: "qwen2.5-coder:1.5b" }] }));
    });
    try {
        const result = await inspectOllama({ baseUrl: api.url });
        assert.equal(result.available, true);
        assert.deepEqual(result.models.sort(), ["qwen2.5-coder:1.5b", "qwen2.5-coder:3b"]);
    } finally { await new Promise((resolve) => api.server.close(resolve)); }
});

test("runtime governor only downgrades a configured plan when current resources are worse", () => {
    const configured = { tier: "balanced", profile: "balanced", model: "qwen2.5-coder:7b", maxContextTokens: 4096, maxRepairs: 2, maxReviewRounds: 1, agentTeamEnabled: true };
    const current = { tier: "minimal", profile: "low-resource", model: "qwen2.5-coder:1.5b", maxContextTokens: 1536, maxRepairs: 1, maxReviewRounds: 0, agentTeamEnabled: false };
    const selected = chooseConservativePlan(configured, current);
    assert.equal(selected.resourcePressure, true);
    assert.equal(selected.tier, "minimal");
    assert.equal(selected.model, "qwen2.5-coder:1.5b");
    const roomy = chooseConservativePlan(configured, { ...current, tier: "high-quality", model: "qwen2.5-coder:32b" });
    assert.equal(roomy.resourcePressure, false);
    assert.equal(roomy.model, "qwen2.5-coder:7b");
});

test("runtime model selection prefers an installed smaller fallback over a missing preferred model", () => {
    const result = selectInstalledModel({ preferred: "qwen2.5-coder:7b", fallbacks: ["qwen2.5-coder:3b", "qwen2.5-coder:1.5b"], installedModels: ["qwen2.5-coder:3b"] });
    assert.equal(result.model, "qwen2.5-coder:3b");
    assert.equal(result.matched, true);
});

test("runtime health blocks local AI launch at dangerously low memory headroom", async () => {
    const hardware = { memoryGiB: 8, availableMemoryGiB: 0.9, logicalCpus: 4, maxGpuVramGiB: 0, disk: { freeGiB: 20 }, tools: { ollama: true, git: true } };
    const result = await buildRuntimeHealth({ hardware, machineConfig: { tier: "low-resource", model: "qwen2.5-coder:3b" }, ollama: { available: true, models: ["qwen2.5-coder:1.5b"] } });
    assert.equal(result.status, "blocked");
    assert.equal(result.blocked, true);
    assert.match(result.warnings[0], /1\.25 GiB/);
});

test("health self-test treats Ollama as optional but workspace and Node as required", async () => {
    const dir = await tempDir();
    const result = await runSelfTest({
        workspace: dir,
        machineConfig: { tier: "minimal", model: "qwen2.5-coder:1.5b" },
        inspectSystemFn: async () => ({ memoryGiB: 6, availableMemoryGiB: 3, logicalCpus: 2, maxGpuVramGiB: 0, disk: { freeGiB: 20 }, tools: {} }),
        inspectOllamaFn: async () => ({ available: false, models: [], error: "offline" })
    });
    assert.equal(result.passed, true);
    assert.equal(result.checks.find((x) => x.name === "ollama").optional, true);
});

test("Ollama planner retries a smaller configured model after a retryable local runtime failure", async () => {
    const seen = [];
    const api = await server((req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
            const parsed = JSON.parse(body);
            seen.push(parsed.model);
            if (parsed.model === "qwen2.5-coder:7b") {
                res.writeHead(503, { "content-type": "text/plain" });
                res.end("model needs more memory");
                return;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ response: JSON.stringify({ actions: [], verify: [] }) }));
        });
    });
    try {
        const planner = new OllamaPlanner({ model: "qwen2.5-coder:7b", fallbackModels: ["qwen2.5-coder:3b"], baseUrl: api.url });
        const plan = await planner.plan({ goal: "test" }, { files: [], git: { isRepository: false } });
        assert.deepEqual(plan.actions, []);
        assert.deepEqual(seen, ["qwen2.5-coder:7b", "qwen2.5-coder:3b"]);
        assert.equal(planner.lastModelUsed, "qwen2.5-coder:3b");
    } finally { await new Promise((resolve) => api.server.close(resolve)); }
});

test("dashboard adaptive runtime rewrites queued task conservatively before execution", async () => {
    const dir = await tempDir();
    const taskPath = path.join(dir, "task.json");
    await fs.writeFile(taskPath, JSON.stringify({ goal: "x", model: "qwen2.5-coder:7b", maxContextTokens: 6000, maxRepairs: 3, agentTeam: { enabled: true, maxReviewRounds: 2 } }));
    const manager = new DashboardJobManager({
        machineConfig: { adaptiveRuntime: true, tier: "balanced", model: "qwen2.5-coder:7b" },
        runtimeHealthBuilder: async () => ({
            checkedAt: "2026-10-24T00:00:00Z", status: "ready", blocked: false,
            hardware: { availableMemoryGiB: 3 }, warnings: [],
            plan: { tier: "minimal", model: "qwen2.5-coder:1.5b", modelFallbacks: [], resourcePressure: true, maxContextTokens: 1536, maxRepairs: 1, maxReviewRounds: 0, agentTeamEnabled: false }
        })
    });
    const job = { taskPath, log: "", taskId: "old" };
    await manager.prepareAdaptiveRuntime(job);
    const task = JSON.parse(await fs.readFile(taskPath, "utf8"));
    assert.equal(task.model, "qwen2.5-coder:1.5b");
    assert.equal(task.maxContextTokens, 1536);
    assert.equal(task.maxRepairs, 1);
    assert.equal(task.agentTeam.enabled, false);
    assert.equal(task.agentTeam.maxReviewRounds, 0);
    assert.match(job.log, /Adaptive runtime/);
});
