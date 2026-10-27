import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectSystem, loadMachineConfig } from "./system-inspector.js";
import { buildRuntimeHealth } from "./runtime-health.js";
import { listRecoveryJournals } from "./recovery.js";
import { writeZip } from "./zip.js";

function scrubRecovery(item) {
    return {
        taskId: item.taskId,
        status: item.status,
        stale: Boolean(item.stale),
        phase: item.phase ?? null,
        startedAt: item.startedAt ?? null,
        updatedAt: item.updatedAt ?? null,
        completedAt: item.completedAt ?? null,
        error: item.error ? String(item.error).slice(0, 1000) : null,
        detail: item.detail && typeof item.detail === "object" ? {
            apply: item.detail.apply,
            status: item.detail.status
        } : null
    };
}

function scrubHardware(hardware) {
    return {
        platform: hardware.platform,
        arch: hardware.arch,
        memoryGiB: hardware.memoryGiB,
        availableMemoryGiB: hardware.availableMemoryGiB,
        logicalCpus: hardware.logicalCpus,
        cpuModels: hardware.cpuModels,
        gpus: hardware.gpus,
        maxGpuVramGiB: hardware.maxGpuVramGiB,
        disk: hardware.disk,
        tools: hardware.tools
    };
}

export async function createDiagnosticBundle(workspace, { version = "unknown", outputPath = null } = {}) {
    const root = path.resolve(workspace ?? ".");
    const hardware = await inspectSystem();
    const machineConfig = await loadMachineConfig().catch(() => null);
    const health = await buildRuntimeHealth({ machineConfig, hardware }).catch((error) => ({ status: "error", error: error.message }));
    const recovery = await listRecoveryJournals(root).catch(() => []);
    const diagnostic = {
        version: 1,
        generatedAt: new Date().toISOString(),
        privacy: {
            sourceCodeIncluded: false,
            promptContentsIncluded: false,
            secretsIncluded: false,
            repositoryFileNamesIncluded: false
        },
        forgePilotVersion: version,
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        hardware: scrubHardware(hardware),
        machinePlan: machineConfig ? {
            tier: machineConfig.tier,
            profile: machineConfig.profile,
            model: machineConfig.model,
            modelFallbacks: machineConfig.modelFallbacks,
            maxContextTokens: machineConfig.maxContextTokens,
            maxRepairs: machineConfig.maxRepairs,
            agentTeamEnabled: machineConfig.agentTeamEnabled
        } : null,
        runtimeHealth: health ? {
            status: health.status,
            blocked: health.blocked,
            plan: health.plan ? { tier: health.plan.tier, model: health.plan.model, modelFallbacks: health.plan.modelFallbacks, resourcePressure: health.plan.resourcePressure } : null,
            ollama: health.ollama ? { available: health.ollama.available, modelCount: health.ollama.models?.length ?? 0, error: health.ollama.error ?? null } : null,
            warnings: health.warnings ?? []
        } : null,
        recentRecovery: recovery.slice(0, 20).map(scrubRecovery)
    };
    const target = path.resolve(outputPath ?? path.join(root, ".forgepilot", "diagnostics", `ForgePilot-Diagnostics-${Date.now()}.zip`));
    const summary = [
        `ForgePilot diagnostics`,
        `Version: ${version}`,
        `Generated: ${diagnostic.generatedAt}`,
        `Platform: ${diagnostic.platform}`,
        `Node: ${diagnostic.node}`,
        `Runtime health: ${diagnostic.runtimeHealth?.status ?? "unknown"}`,
        "",
        "Privacy: source code, prompt contents, secrets, and repository file names are excluded by default."
    ].join("\n") + "\n";
    await writeZip(target, [
        { name: "diagnostics.json", data: JSON.stringify(diagnostic, null, 2) + "\n" },
        { name: "README.txt", data: summary }
    ]);
    return { path: target, diagnostic };
}
