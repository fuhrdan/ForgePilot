import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { commandExists } from "../core/command.js";

function gib(bytes) {
    return Number((Number(bytes || 0) / (1024 ** 3)).toFixed(1));
}

async function defaultRunner(command, args = [], { timeoutMs = 8000 } = {}) {
    return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let child;
        try {
            child = spawn(command, args, { shell: false, windowsHide: true, env: process.env });
        } catch (error) {
            resolve({ exitCode: -1, stdout, stderr: error.message });
            return;
        }
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("error", (error) => { stderr += error.message; });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ exitCode: code ?? -1, stdout, stderr });
        });
    });
}

async function inspectWindowsGpu(runner) {
    const script = [
        "$ErrorActionPreference='SilentlyContinue'",
        "$g=Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM",
        "$g | ConvertTo-Json -Compress"
    ].join(";");
    const result = await runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    if (result.exitCode !== 0 || !result.stdout.trim()) return [];
    try {
        const parsed = JSON.parse(result.stdout.trim());
        const items = Array.isArray(parsed) ? parsed : [parsed];
        return items.filter(Boolean).map((item) => ({
            name: String(item.Name ?? "Unknown GPU"),
            vramGiB: item.AdapterRAM ? gib(Number(item.AdapterRAM)) : null
        }));
    } catch {
        return [];
    }
}

async function inspectDisk(targetPath) {
    try {
        const stats = await fs.statfs(targetPath);
        return {
            freeGiB: gib(Number(stats.bavail) * Number(stats.bsize)),
            totalGiB: gib(Number(stats.blocks) * Number(stats.bsize))
        };
    } catch {
        return { freeGiB: null, totalGiB: null };
    }
}

export async function inspectSystem({
    platform = process.platform,
    arch = process.arch,
    totalmem = os.totalmem(),
    freemem = os.freemem(),
    cpus = os.cpus(),
    homedir = os.homedir(),
    runner = defaultRunner,
    toolProbe = commandExists
} = {}) {
    const cpuModels = [...new Set((cpus ?? []).map((cpu) => String(cpu?.model ?? "").trim()).filter(Boolean))];
    const tools = {};
    for (const tool of ["node", "git", "ollama", "npm", "python", "dotnet", "java", "go", "cargo", "docker", "podman", "code", "godot4", "godot"]) {
        try { tools[tool] = Boolean(await toolProbe(tool)); } catch { tools[tool] = false; }
    }
    const gpus = platform === "win32" ? await inspectWindowsGpu(runner) : [];
    const disk = await inspectDisk(homedir);
    return {
        platform,
        arch,
        memoryGiB: gib(totalmem),
        availableMemoryGiB: gib(freemem),
        logicalCpus: cpus?.length ?? 1,
        cpuModels,
        gpus,
        maxGpuVramGiB: Math.max(0, ...gpus.map((gpu) => Number(gpu.vramGiB ?? 0))),
        disk,
        tools
    };
}

export function recommendMachinePlan(hardware) {
    const ram = Number(hardware?.memoryGiB ?? 0);
    const availableRam = Number(hardware?.availableMemoryGiB ?? ram);
    const cpus = Number(hardware?.logicalCpus ?? 1);
    const vram = Number(hardware?.maxGpuVramGiB ?? 0);
    const freeDisk = Number(hardware?.disk?.freeGiB ?? 999);

    let tier;
    if (ram < 10 || cpus <= 2 || availableRam < 3) tier = "minimal";
    else if (ram < 20 || cpus < 6 || availableRam < 6) tier = "low-resource";
    else if (ram < 48 || availableRam < 12) tier = "balanced";
    else tier = "high-quality";

    const plans = {
        minimal: {
            profile: "low-resource",
            model: "qwen2.5-coder:1.5b",
            bootstrapModel: "qwen2.5-coder:1.5b",
            visionModel: null,
            maxContextTokens: 1536,
            maxRepairs: 1,
            maxReviewRounds: 0,
            agentTeamEnabled: false,
            ollama: { numParallel: 1, maxLoadedModels: 1, keepAlive: "60s" }
        },
        "low-resource": {
            profile: "low-resource",
            model: "qwen2.5-coder:3b",
            bootstrapModel: "qwen2.5-coder:3b",
            visionModel: null,
            maxContextTokens: 2304,
            maxRepairs: 1,
            maxReviewRounds: 1,
            agentTeamEnabled: false,
            ollama: { numParallel: 1, maxLoadedModels: 1, keepAlive: "2m" }
        },
        balanced: {
            profile: "balanced",
            model: vram >= 16 && ram >= 32 ? "qwen2.5-coder:14b" : "qwen2.5-coder:7b",
            bootstrapModel: "qwen2.5-coder:7b",
            visionModel: ram >= 28 ? "qwen3-vl:4b" : null,
            maxContextTokens: ram >= 32 ? 6000 : 4096,
            maxRepairs: 2,
            maxReviewRounds: 1,
            agentTeamEnabled: true,
            ollama: { numParallel: 1, maxLoadedModels: 1, keepAlive: "5m" }
        },
        "high-quality": {
            profile: "high-quality",
            model: vram >= 24 || ram >= 96 ? "qwen2.5-coder:32b" : "qwen2.5-coder:14b",
            bootstrapModel: "qwen2.5-coder:7b",
            visionModel: "qwen3-vl:8b",
            maxContextTokens: 12000,
            maxRepairs: 3,
            maxReviewRounds: 2,
            agentTeamEnabled: true,
            ollama: { numParallel: ram >= 96 ? 2 : 1, maxLoadedModels: 1, keepAlive: "10m" }
        }
    };
    const plan = { tier, ...plans[tier] };
    const notes = [];
    if (ram < 8) notes.push("Very low RAM detected; close browsers/games before AI runs and expect slower local inference.");
    else if (availableRam < 6) notes.push("Current free RAM is low; ForgePilot temporarily selected a smaller runtime plan for this launch.");
    if (freeDisk < 8) notes.push("Less than 8 GiB free disk space detected; model downloads may fail.");
    if (!hardware?.tools?.ollama) notes.push("Ollama is not currently detected; one-click installer can bootstrap it on Windows.");
    if (!hardware?.tools?.git) notes.push("Git is not currently detected; repository intelligence works best with Git installed.");
    if (!plan.visionModel) notes.push("Vision model disabled by default to conserve memory.");
    return { ...plan, hardware, notes };
}

export function machineConfigPath({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
    if (env.FORGEPILOT_HOME) return path.join(env.FORGEPILOT_HOME, "config", "machine-profile.json");
    if (platform === "win32" && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "ForgePilot", "config", "machine-profile.json");
    return path.join(homedir, ".config", "forgepilot", "machine-profile.json");
}

export async function saveMachineConfig(config, options = {}) {
    const target = options.path ?? machineConfigPath(options);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(config, null, 2) + "\n", "utf8");
    return target;
}

export async function loadMachineConfig(options = {}) {
    const target = options.path ?? machineConfigPath(options);
    try { return JSON.parse(await fs.readFile(target, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export async function writeLauncherEnvironment(config, targetPath) {
    const lines = [
        "@echo off",
        `set \"FORGEPILOT_PROFILE=${config.profile}\"`,
        `set \"FORGEPILOT_MODEL=${config.model}\"`,
        `set \"OLLAMA_NUM_PARALLEL=${config.ollama?.numParallel ?? 1}\"`,
        `set \"OLLAMA_MAX_LOADED_MODELS=${config.ollama?.maxLoadedModels ?? 1}\"`,
        `set \"OLLAMA_KEEP_ALIVE=${config.ollama?.keepAlive ?? "2m"}\"`
    ];
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, lines.join("\r\n") + "\r\n", "ascii");
    return targetPath;
}
