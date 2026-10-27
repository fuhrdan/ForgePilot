import fs from "node:fs/promises";
import path from "node:path";
import { createSimpleBuildWorkspace, SIMPLE_BUILD_DEFAULTS } from "./simple-build.js";
import { APPROVAL_CATEGORIES } from "../security/approvals.js";

const PATH_PATTERNS = [
    /\b([A-Za-z]:\\[^\s"'`]+)/g,
    /(?:^|\s)((?:\.{0,2}\/|\/)[^\s"'`]+)/g
];

function trimPathCandidate(value) {
    return String(value ?? "").trim().replace(/[.,;:!?]+$/g, "").replace(/[\\/]$/g, "");
}

export function classifyUniversalIntent(prompt) {
    const text = String(prompt ?? "").trim();
    const lower = text.toLowerCase();
    const readOnly = /\b(review|audit|analy[sz]e|inspect|explain|summari[sz]e|understand|assess)\b/.test(lower)
        && !/\b(fix|change|modify|update|add|implement|build|create|write|refactor|remove|delete|upgrade|migrate)\b/.test(lower);
    const testOnly = /\b(run|execute)\b.*\b(test|tests|build|lint|check)\b|\b(run tests|test this|build this|compile this)\b/.test(lower)
        && !/\b(fix|change|modify|update|add|implement|create|write|refactor)\b/.test(lower);
    const ui = /\b(browser|website|web page|ui|user interface|click|desktop app|gui|screen|visual)\b/.test(lower);
    const network = /https?:\/\//i.test(text) || /\b(internet|online|download|clone|github\.com|fetch from|look up)\b/.test(lower);
    const secretUse = /\b(secret|api key|token|credential|password|environment variable|env var)\b/.test(lower);
    const release = /\b(release|package|installer|distribution|publish|deploy)\b/.test(lower);
    const intent = readOnly ? "review" : testOnly ? "verify" : release ? "release" : "build";
    const approvals = [];
    if (!readOnly) {
        if (!testOnly) approvals.push("file_write");
        approvals.push("command_exec");
    }
    if (testOnly) approvals.push("command_exec");
    if (ui) approvals.push("computer_control");
    if (network) approvals.push("external_network");
    if (secretUse) approvals.push("secret_use");
    return {
        intent,
        readOnly,
        testOnly,
        ui,
        network,
        secretUse,
        release,
        approvals: [...new Set(approvals)]
    };
}

export async function findWorkspaceInPrompt(prompt, { cwd = process.cwd() } = {}) {
    const text = String(prompt ?? "");
    const candidates = [];
    for (const pattern of PATH_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text))) candidates.push(trimPathCandidate(match[1]));
    }
    const quoted = [...text.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => trimPathCandidate(m[1]));
    candidates.push(...quoted);
    for (const candidate of [...new Set(candidates)]) {
        if (!candidate || candidate.length > 4096) continue;
        const resolved = path.resolve(cwd, candidate);
        const stat = await fs.stat(resolved).catch(() => null);
        if (stat?.isDirectory()) return resolved;
        if (stat?.isFile()) return path.dirname(resolved);
    }
    return null;
}

export async function resolveUniversalWorkspace(rootWorkspace, prompt, { cwd = process.cwd() } = {}) {
    const existing = await findWorkspaceInPrompt(prompt, { cwd });
    if (existing) return { workspace: existing, created: false, projectName: path.basename(existing), source: "prompt-path" };
    const allocated = await createSimpleBuildWorkspace(rootWorkspace, { description: prompt });
    return { ...allocated, source: "auto-project" };
}

export function buildUniversalTask({ prompt, machineConfig = {}, ollamaUrl = null, jobId = null, intent = null } = {}) {
    const goal = String(prompt ?? "").trim();
    if (!goal) throw new Error("Tell ForgePilot what you want it to do.");
    const inferred = intent ?? classifyUniversalIntent(goal);
    return {
        goal,
        planner: "ollama",
        model: machineConfig.model ?? "qwen2.5-coder:3b",
        modelFallbacks: machineConfig.modelFallbacks ?? ["qwen2.5-coder:1.5b"],
        ...(ollamaUrl ? { ollamaUrl } : {}),
        maxContextTokens: Math.min(Number(machineConfig.maxContextTokens ?? 3072), 4096),
        maxRepairs: Math.min(Number(machineConfig.maxRepairs ?? SIMPLE_BUILD_DEFAULTS.maxRepairs), SIMPLE_BUILD_DEFAULTS.maxRepairs),
        agentTeam: { enabled: false, maxReviewRounds: 0, requireVerifierApproval: false },
        permissions: { require: [...APPROVAL_CATEGORIES] },
        sandbox: { enabled: false },
        watchdog: { ...SIMPLE_BUILD_DEFAULTS },
        simpleBuild: true,
        universalPrompt: true,
        metadata: {
            createdBy: "forgepilot-universal-prompt",
            dashboardJobId: jobId,
            simpleBuild: true,
            universalPrompt: true,
            inferredIntent: inferred.intent,
            inferredCapabilities: inferred.approvals
        }
    };
}
