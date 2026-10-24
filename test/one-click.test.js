import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectSystem, recommendMachinePlan, saveMachineConfig, loadMachineConfig, writeLauncherEnvironment } from "../src/product/system-inspector.js";
import { createDashboardServer } from "../src/dashboard/server.js";
import { defaultWorkspace, openLocalUrl } from "../src/product/launcher.js";

async function tempDir(prefix = "fp010-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

function hardware(memoryGiB, logicalCpus, extra = {}) {
    return {
        memoryGiB,
        availableMemoryGiB: Math.max(1, memoryGiB / 2),
        logicalCpus,
        maxGpuVramGiB: 0,
        disk: { freeGiB: 40, totalGiB: 100 },
        tools: { ollama: true, git: true },
        ...extra
    };
}

test("very small machines select a 1.5B model and disable expensive agent/vision features", () => {
    const plan = recommendMachinePlan(hardware(6, 2));
    assert.equal(plan.tier, "minimal");
    assert.equal(plan.model, "qwen2.5-coder:1.5b");
    assert.equal(plan.visionModel, null);
    assert.equal(plan.agentTeamEnabled, false);
    assert.equal(plan.ollama.numParallel, 1);
});

test("low-resource machines choose a 3B bootstrap-friendly model with bounded context", () => {
    const plan = recommendMachinePlan(hardware(16, 4));
    assert.equal(plan.tier, "low-resource");
    assert.equal(plan.model, "qwen2.5-coder:3b");
    assert.ok(plan.maxContextTokens <= 2304);
    assert.equal(plan.maxRepairs, 1);
});

test("balanced machines stay on 7B unless substantial VRAM is available", () => {
    const normal = recommendMachinePlan(hardware(32, 8));
    const gpuRich = recommendMachinePlan(hardware(32, 8, { maxGpuVramGiB: 16 }));
    assert.equal(normal.model, "qwen2.5-coder:7b");
    assert.equal(gpuRich.model, "qwen2.5-coder:14b");
    assert.equal(normal.bootstrapModel, "qwen2.5-coder:7b");
});

test("system inspection accepts injected Windows probes and normalizes GPU evidence", async () => {
    const dir = await tempDir();
    const result = await inspectSystem({
        platform: "win32",
        arch: "x64",
        totalmem: 16 * 1024 ** 3,
        freemem: 8 * 1024 ** 3,
        cpus: Array(4).fill({ model: "Test CPU" }),
        homedir: dir,
        toolProbe: async (name) => name === "node" || name === "git",
        runner: async () => ({ exitCode: 0, stdout: JSON.stringify({ Name: "Test GPU", AdapterRAM: 4 * 1024 ** 3 }), stderr: "" })
    });
    assert.equal(result.memoryGiB, 16);
    assert.equal(result.availableMemoryGiB, 8);
    assert.equal(result.gpus[0].name, "Test GPU");
    assert.equal(result.gpus[0].vramGiB, 4);
    assert.equal(result.tools.git, true);
    assert.equal(result.tools.ollama, false);
});

test("machine config and launcher environment persist low-resource limits", async () => {
    const dir = await tempDir();
    const configPath = path.join(dir, "machine.json");
    const envPath = path.join(dir, "launcher-env.cmd");
    const config = { profile: "low-resource", model: "qwen2.5-coder:3b", ollama: { numParallel: 1, maxLoadedModels: 1, keepAlive: "2m" } };
    await saveMachineConfig(config, { path: configPath });
    await writeLauncherEnvironment(config, envPath);
    assert.deepEqual(await loadMachineConfig({ path: configPath }), config);
    const text = await fs.readFile(envPath, "utf8");
    assert.match(text, /OLLAMA_NUM_PARALLEL=1/);
    assert.match(text, /OLLAMA_MAX_LOADED_MODELS=1/);
    assert.match(text, /FORGEPILOT_MODEL=qwen2\.5-coder:3b/);
});

test("launcher dashboard exposes the selected machine profile only on loopback", async () => {
    const workspace = await tempDir();
    const machineConfig = { tier: "minimal", profile: "low-resource", model: "qwen2.5-coder:1.5b" };
    const dashboard = await createDashboardServer({ workspace, port: 0, launcher: { machineConfig } });
    try {
        const response = await fetch(`http://${dashboard.host}:${dashboard.port}/api/system`);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).tier, "minimal");
    } finally {
        await new Promise((resolve) => dashboard.server.close(resolve));
    }
    await assert.rejects(createDashboardServer({ workspace, host: "0.0.0.0", port: 0 }), /loopback-only/);
});

test("one-click launcher defaults to Documents and refuses to open non-loopback URLs", async () => {
    const home = path.join(path.sep, "Users", "Example");
    assert.equal(await defaultWorkspace({ platform: "win32", homedir: home, env: {} }), path.join(home, "Documents", "ForgePilot Workspace"));
    await assert.rejects(openLocalUrl("https://example.com/"), /Refusing to open non-loopback/);
});
