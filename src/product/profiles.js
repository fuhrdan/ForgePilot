import os from "node:os";

export const BUILTIN_PROFILES = Object.freeze({
    "low-resource": Object.freeze({
        name: "low-resource",
        description: "Conservative local profile for modest RAM/CPU systems.",
        model: "qwen2.5-coder:7b",
        visionModel: "qwen3-vl:4b",
        maxContextTokens: 3000,
        maxRepairs: 1,
        maxReviewRounds: 1
    }),
    balanced: Object.freeze({
        name: "balanced",
        description: "Default balance between local model quality and resource use.",
        model: "qwen2.5-coder:14b",
        visionModel: "qwen3-vl:8b",
        maxContextTokens: 6000,
        maxRepairs: 2,
        maxReviewRounds: 2
    }),
    "high-quality": Object.freeze({
        name: "high-quality",
        description: "Larger-context profile for high-memory workstations.",
        model: "qwen2.5-coder:32b",
        visionModel: "qwen3-vl:8b",
        maxContextTokens: 12000,
        maxRepairs: 3,
        maxReviewRounds: 3
    })
});

export function detectHardware({ totalmem = os.totalmem(), cpus = os.cpus(), platform = process.platform, arch = process.arch } = {}) {
    const memoryGiB = Number((totalmem / (1024 ** 3)).toFixed(1));
    return { platform, arch, memoryGiB, logicalCpus: cpus?.length ?? 1 };
}

export function recommendProfile(hardware = detectHardware()) {
    if (hardware.memoryGiB < 20 || hardware.logicalCpus < 6) return "low-resource";
    if (hardware.memoryGiB < 64) return "balanced";
    return "high-quality";
}

export function resolveProfile(name = "auto", hardware = detectHardware()) {
    const resolvedName = name === "auto" ? recommendProfile(hardware) : name;
    const profile = BUILTIN_PROFILES[resolvedName];
    if (!profile) throw new Error(`Unknown ForgePilot profile: ${name}`);
    return { ...profile, requested: name, recommended: recommendProfile(hardware), hardware };
}
