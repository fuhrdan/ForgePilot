import fs from "node:fs/promises";
import path from "node:path";

export const SIMPLE_BUILD_DEFAULTS = Object.freeze({
    modelTimeoutMs: 120000,
    commandTimeoutMs: 300000,
    noProgressTimeoutMs: 300000,
    overallTimeoutMs: 1800000,
    maxRepairs: 2,
    maxReviewRounds: 0
});

export function slugifyProjectName(value, fallback = "forgepilot-project") {
    const slug = String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return slug || fallback;
}

function descriptionName(description) {
    const words = String(description ?? "")
        .replace(/[^A-Za-z0-9\s_-]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 6)
        .join(" ");
    return slugifyProjectName(words);
}

async function availableDirectory(base) {
    let candidate = base;
    for (let index = 2; index < 1000; index++) {
        try {
            await fs.access(candidate);
            candidate = `${base}-${index}`;
        } catch {
            return candidate;
        }
    }
    throw new Error("Unable to allocate a new ForgePilot project directory.");
}

export async function createSimpleBuildWorkspace(rootWorkspace, { description, projectName = null, workspace = null } = {}) {
    if (workspace) {
        const resolved = path.resolve(String(workspace));
        const stat = await fs.stat(resolved).catch(() => null);
        if (!stat?.isDirectory()) throw new Error(`Existing project directory was not found: ${resolved}`);
        return { workspace: resolved, created: false, projectName: path.basename(resolved) };
    }

    const root = path.resolve(rootWorkspace ?? ".");
    const projectsRoot = path.join(root, "Projects");
    await fs.mkdir(projectsRoot, { recursive: true });
    const name = slugifyProjectName(projectName ?? descriptionName(description));
    const target = await availableDirectory(path.join(projectsRoot, name));
    await fs.mkdir(target, { recursive: true });
    return { workspace: target, created: true, projectName: path.basename(target) };
}

export function buildSimpleTask({ description, machineConfig = {}, ollamaUrl = null, jobId = null } = {}) {
    const goal = String(description ?? "").trim();
    if (!goal) throw new Error("Describe what you want ForgePilot to build.");
    return {
        goal,
        planner: "ollama",
        model: machineConfig.model ?? "qwen2.5-coder:3b",
        modelFallbacks: machineConfig.modelFallbacks ?? ["qwen2.5-coder:1.5b"],
        ...(ollamaUrl ? { ollamaUrl } : {}),
        maxContextTokens: Math.min(Number(machineConfig.maxContextTokens ?? 3072), 4096),
        maxRepairs: Math.min(Number(machineConfig.maxRepairs ?? SIMPLE_BUILD_DEFAULTS.maxRepairs), SIMPLE_BUILD_DEFAULTS.maxRepairs),
        agentTeam: {
            enabled: false,
            maxReviewRounds: 0,
            requireVerifierApproval: false
        },
        permissions: { require: ["file_write", "command_exec", "computer_control", "external_network", "secret_use", "sandbox_network"] },
        sandbox: { enabled: false },
        watchdog: { ...SIMPLE_BUILD_DEFAULTS },
        simpleBuild: true,
        metadata: {
            createdBy: "forgepilot-just-build-it",
            dashboardJobId: jobId,
            simpleBuild: true
        }
    };
}
