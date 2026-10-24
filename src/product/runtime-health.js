import fs from "node:fs/promises";
import path from "node:path";
import { inspectSystem, recommendMachinePlan, loadMachineConfig } from "./system-inspector.js";

const TIER_RANK = Object.freeze({ minimal: 0, "low-resource": 1, balanced: 2, "high-quality": 3 });
const KNOWN_MODELS = Object.freeze([
    "qwen2.5-coder:1.5b",
    "qwen2.5-coder:3b",
    "qwen2.5-coder:7b",
    "qwen2.5-coder:14b",
    "qwen2.5-coder:32b"
]);

function unique(items) {
    return [...new Set((items ?? []).map((item) => String(item ?? "").trim()).filter(Boolean))];
}

export function modelFallbacksFor(model) {
    const selected = String(model ?? "").trim();
    const index = KNOWN_MODELS.indexOf(selected);
    if (index < 0) return unique(["qwen2.5-coder:7b", "qwen2.5-coder:3b", "qwen2.5-coder:1.5b"]).filter((item) => item !== selected);
    return KNOWN_MODELS.slice(0, index).reverse();
}

export async function inspectOllama({ baseUrl = "http://127.0.0.1:11434", fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/api/tags`, { signal: controller.signal });
        if (!response.ok) return { available: false, models: [], status: response.status, error: `HTTP ${response.status}` };
        const body = await response.json();
        const models = unique((body?.models ?? []).flatMap((item) => [item?.name, item?.model]));
        return { available: true, models, status: response.status, error: null };
    } catch (error) {
        return { available: false, models: [], status: null, error: error?.name === "AbortError" ? "timeout" : String(error?.message ?? error) };
    } finally {
        clearTimeout(timer);
    }
}

function hasModel(installedModels, candidate) {
    const base = String(candidate).split(":")[0];
    return installedModels.some((item) => item === candidate || item.startsWith(`${candidate}:`) || (candidate.includes(":") && item === candidate) || (!candidate.includes(":") && item.startsWith(`${base}:`)));
}

export function selectInstalledModel({ preferred, fallbacks = [], installedModels = [] } = {}) {
    const candidates = unique([preferred, ...fallbacks]);
    if (!installedModels.length) return { model: preferred, matched: false, candidates };
    const model = candidates.find((candidate) => hasModel(installedModels, candidate));
    return { model: model ?? preferred, matched: Boolean(model), candidates };
}

export function chooseConservativePlan(configured, currentPlan) {
    if (!configured) return { ...currentPlan, modelFallbacks: modelFallbacksFor(currentPlan.model) };
    const configuredRank = TIER_RANK[configured.tier] ?? TIER_RANK[configured.profile] ?? 2;
    const currentRank = TIER_RANK[currentPlan.tier] ?? 2;
    const pressured = currentRank < configuredRank;
    const base = pressured ? currentPlan : configured;
    const model = base.model ?? currentPlan.model;
    const fallbacks = unique([...(base.modelFallbacks ?? []), ...modelFallbacksFor(model)]).filter((item) => item !== model);
    return {
        ...base,
        tier: pressured ? currentPlan.tier : (configured.tier ?? currentPlan.tier),
        model,
        modelFallbacks: fallbacks,
        resourcePressure: pressured,
        configuredTier: configured.tier ?? configured.profile ?? null,
        currentTier: currentPlan.tier
    };
}

export async function buildRuntimeHealth({ machineConfig = null, hardware = null, ollama = null, baseUrl = "http://127.0.0.1:11434", inspectSystemFn = inspectSystem, inspectOllamaFn = inspectOllama } = {}) {
    const currentHardware = hardware ?? await inspectSystemFn();
    const currentPlan = recommendMachinePlan(currentHardware);
    const conservative = chooseConservativePlan(machineConfig, currentPlan);
    const ollamaState = ollama ?? await inspectOllamaFn({ baseUrl });
    const installed = selectInstalledModel({ preferred: conservative.model, fallbacks: conservative.modelFallbacks, installedModels: ollamaState.models });
    const selectedModel = installed.matched ? installed.model : conservative.model;
    const selectedFallbacks = unique([...(conservative.modelFallbacks ?? []), ...modelFallbacksFor(selectedModel)])
        .filter((item) => item !== selectedModel)
        .filter((item) => !ollamaState.models.length || hasModel(ollamaState.models, item));
    const availableRam = Number(currentHardware.availableMemoryGiB ?? 0);
    const blocked = availableRam > 0 && availableRam < 1.25;
    const warnings = [];
    if (blocked) warnings.push("Less than 1.25 GiB RAM is currently available; close other applications before starting a local AI job.");
    if (conservative.resourcePressure) warnings.push(`Current resource pressure downgraded this launch from ${conservative.configuredTier} to ${conservative.currentTier}.`);
    if (!ollamaState.available) warnings.push("Ollama is not currently responding; deterministic ForgePilot features still work, but local AI jobs need Ollama.");
    else if (ollamaState.models.length === 0) warnings.push("Ollama is running but no local models are installed.");
    else if (selectedModel !== conservative.model) warnings.push(`Preferred model ${conservative.model} is not installed; using ${selectedModel}.`);
    return {
        checkedAt: new Date().toISOString(),
        status: blocked ? "blocked" : ollamaState.available ? "ready" : "limited",
        blocked,
        hardware: currentHardware,
        plan: { ...conservative, model: selectedModel, modelFallbacks: selectedFallbacks },
        ollama: ollamaState,
        warnings
    };
}

export async function runSelfTest({ workspace = ".", machineConfig = null, baseUrl = "http://127.0.0.1:11434", inspectSystemFn = inspectSystem, inspectOllamaFn = inspectOllama } = {}) {
    const resolved = path.resolve(workspace);
    const config = machineConfig ?? await loadMachineConfig().catch(() => null);
    const health = await buildRuntimeHealth({ machineConfig: config, baseUrl, inspectSystemFn, inspectOllamaFn });
    const checks = [];
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    checks.push({ name: "node", passed: nodeMajor >= 22, detail: process.version });
    const stat = await fs.stat(resolved).catch(() => null);
    checks.push({ name: "workspace", passed: Boolean(stat?.isDirectory()), detail: resolved });
    if (stat?.isDirectory()) {
        const probe = path.join(resolved, `.forgepilot-health-${process.pid}-${Date.now()}.tmp`);
        try {
            await fs.writeFile(probe, "ok\n", "utf8");
            await fs.unlink(probe);
            checks.push({ name: "workspace-write", passed: true, detail: "writable" });
        } catch (error) {
            checks.push({ name: "workspace-write", passed: false, detail: error.message });
        }
    }
    checks.push({ name: "memory-headroom", passed: !health.blocked, detail: `${health.hardware.availableMemoryGiB} GiB available` });
    checks.push({ name: "ollama", passed: health.ollama.available, optional: true, detail: health.ollama.available ? `${health.ollama.models.length} model(s)` : health.ollama.error });
    const requiredPassed = checks.filter((item) => !item.optional).every((item) => item.passed);
    return { passed: requiredPassed, checks, health };
}
