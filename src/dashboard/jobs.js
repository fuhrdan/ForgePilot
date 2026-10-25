import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRepositoryContext } from "../repository/context.js";
import { createTaskId } from "../core/state.js";
import { verifyReportProvenance } from "../security/provenance.js";
import { APPROVAL_CATEGORIES } from "../security/approvals.js";
import { applyRecipe } from "./recipes.js";
import { buildPreflight } from "../repository/preflight.js";
import { createWorkspaceCheckpoint, finalizeWorkspaceCheckpoint, rollbackWorkspaceCheckpoint } from "../repository/checkpoint.js";
import { buildRuntimeHealth } from "../product/runtime-health.js";
import { buildPatchReview } from "../repository/patch-review.js";
import { buildDashboardConfidence } from "../quality/confidence.js";
import { createSimpleBuildWorkspace, buildSimpleTask, SIMPLE_BUILD_DEFAULTS } from "../product/simple-build.js";

const DEFAULT_CLI = fileURLToPath(new URL("../cli.js", import.meta.url));
const AUTONOMY = Object.freeze({
    safe: { label: "Safe", agentTeam: false, maxRepairs: 1, maxReviewRounds: 0 },
    standard: { label: "Standard", agentTeam: null, maxRepairs: null, maxReviewRounds: null },
    thorough: { label: "Thorough", agentTeam: true, maxRepairs: 3, maxReviewRounds: 2 }
});

function cleanText(value, max = 4000) {
    return String(value ?? "").replace(/\0/g, "").trim().slice(0, max);
}

async function ensureDirectory(target) {
    const resolved = path.resolve(cleanText(target, 4096));
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`Workspace is not an existing directory: ${resolved}`);
    return resolved;
}

function sanitizeApprovals(items, fallback = []) {
    const list = Array.isArray(items) ? items : fallback;
    return [...new Set(list.map(String).filter((item) => APPROVAL_CATEGORIES.includes(item)))];
}

function summarizeRepository(repository) {
    return {
        scan: repository.scan,
        projects: repository.projects,
        commandHints: repository.commandHints,
        testing: repository.testing ? {
            testFileCount: repository.testing.testFileCount,
            selectedTests: repository.testing.selectedTests,
            primaryTestCommand: repository.testing.primaryTestCommand,
            targetedTestCommand: repository.testing.targetedTestCommand,
            regressionCommand: repository.testing.regressionCommand,
            buildCommands: repository.testing.buildCommands
        } : null,
        selectedFiles: (repository.selectedFiles ?? []).map(({ path: filePath, score }) => ({ path: filePath, score }))
    };
}

function persistentJob(job) {
    const { child, ...rest } = job;
    return rest;
}

export class DashboardJobManager {
    constructor({ machineConfig = null, nodePath = process.execPath, cliPath = DEFAULT_CLI, spawner = spawn, maxLogChars = 120000, ollamaUrl = null, rootWorkspace = null, maxConcurrentJobs = 1, recipeStore = null, runtimeHealthBuilder = buildRuntimeHealth, watchdogFloorMs = 30000, watchdogPollMs = 5000 } = {}) {
        this.machineConfig = machineConfig;
        this.nodePath = nodePath;
        this.cliPath = cliPath;
        this.spawner = spawner;
        this.maxLogChars = maxLogChars;
        this.ollamaUrl = ollamaUrl;
        this.jobs = new Map();
        this.rootWorkspace = rootWorkspace ? path.resolve(rootWorkspace) : null;
        this.statePath = this.rootWorkspace ? path.join(this.rootWorkspace, ".forgepilot", "dashboard", "queue.json") : null;
        this.maxConcurrentJobs = Math.max(1, Math.min(4, Number(maxConcurrentJobs) || 1));
        this.queuePaused = false;
        this.loaded = false;
        this.recipeStore = recipeStore;
        this.runtimeHealthBuilder = runtimeHealthBuilder;
        this.watchdogFloorMs = Math.max(1, Number(watchdogFloorMs) || 30000);
        this.watchdogPollMs = Math.max(1, Number(watchdogPollMs) || 5000);
    }

    configureRoot(rootWorkspace) {
        if (this.rootWorkspace) return;
        this.rootWorkspace = path.resolve(rootWorkspace);
        this.statePath = path.join(this.rootWorkspace, ".forgepilot", "dashboard", "queue.json");
    }

    setRecipeStore(store) {
        this.recipeStore = store;
    }

    async initialize() {
        if (this.loaded) return;
        this.loaded = true;
        if (!this.statePath) return;
        try {
            const saved = JSON.parse(await fs.readFile(this.statePath, "utf8"));
            this.queuePaused = Boolean(saved?.queuePaused);
            for (const value of Array.isArray(saved?.jobs) ? saved.jobs : []) {
                if (!value?.id || !value?.workspace) continue;
                const job = { ...value, child: null };
                if (job.status === "running" || job.phase === "cancelling") {
                    job.status = "interrupted";
                    job.phase = "interrupted";
                    job.error = "ForgePilot dashboard stopped while this job was running.";
                    job.completedAt = new Date().toISOString();
                }
                this.jobs.set(job.id, job);
            }
            await this.persist();
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        if (!this.queuePaused) this.drain();
    }

    async persist() {
        if (!this.statePath) return;
        await fs.mkdir(path.dirname(this.statePath), { recursive: true });
        const jobs = [...this.jobs.values()].map(persistentJob);
        await fs.writeFile(this.statePath, JSON.stringify({ version: 1, queuePaused: this.queuePaused, jobs }, null, 2) + "\n", "utf8");
    }

    async preflight({ workspace, goal = "" }) {
        const resolved = await ensureDirectory(workspace);
        return buildPreflight(resolved, {
            goal: cleanText(goal, 12000),
            maxContextTokens: Math.min(Number(this.machineConfig?.maxContextTokens ?? 4000), 4000)
        });
    }

    async analyze({ workspace, goal = "" }) {
        const resolved = await ensureDirectory(workspace);
        const repository = await buildRepositoryContext(resolved, {
            goal: cleanText(goal),
            maxContextTokens: Math.min(Number(this.machineConfig?.maxContextTokens ?? 4000), 4000),
            maxSelectedFiles: 12
        });
        return { workspace: resolved, ...summarizeRepository(repository) };
    }

    list() {
        return [...this.jobs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((job) => this.publicJob(job));
    }

    get(id) {
        const job = this.jobs.get(String(id));
        return job ? this.publicJob(job) : null;
    }

    queueStatus() {
        const values = [...this.jobs.values()];
        return {
            paused: this.queuePaused,
            maxConcurrentJobs: this.maxConcurrentJobs,
            running: values.filter((job) => job.status === "running").length,
            queued: values.filter((job) => job.status === "queued").length,
            pausedJobs: values.filter((job) => job.status === "paused").length
        };
    }

    publicJob(job) {
        return {
            id: job.id,
            workspace: job.workspace,
            goal: job.goal,
            effectiveGoal: job.effectiveGoal === job.goal ? undefined : job.effectiveGoal,
            recipeId: job.recipeId ?? null,
            recipeName: job.recipeName ?? null,
            autonomy: job.autonomy,
            approvals: job.approvals,
            sandbox: job.sandbox,
            status: job.status,
            phase: job.phase,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            exitCode: job.exitCode,
            taskId: job.taskId,
            taskPath: job.taskPath,
            reportPath: job.reportPath,
            markdownPath: job.markdownPath,
            signed: job.signed,
            retryOf: job.retryOf ?? null,
            preflight: job.preflight ?? null,
            checkpoint: job.checkpoint ?? null,
            changeSet: job.changeSet ?? null,
            rollback: job.rollback ?? null,
            patchReview: job.patchReview ?? null,
            confidence: job.confidence ?? null,
            runtime: job.runtime ?? null,
            simpleBuild: Boolean(job.simpleBuild),
            projectName: job.projectName ?? null,
            watchdog: job.watchdog ?? null,
            lastActivityAt: job.lastActivityAt ?? null,
            log: job.log,
            error: job.error ?? null
        };
    }

    append(job, text) {
        job.lastActivityAt = new Date().toISOString();
        job.log = `${job.log}${String(text)}`.slice(-this.maxLogChars);
        const lines = job.log.split(/\r?\n/).slice(-40);
        for (const line of lines) {
            if (line.startsWith("Progress:")) {
                if (/trying .* after|failed .* trying/i.test(line)) job.phase = "model_fallback";
                else if (/model|generating|waiting/i.test(line)) job.phase = "generating";
                else if (/verif/i.test(line)) job.phase = "verifying";
                else if (/action|implement|build/i.test(line)) job.phase = "building";
            }
            else if (line.startsWith("Plan rationale:")) job.phase = "planned";
            else if (line.startsWith("Actions:")) job.phase = "executing";
            else if (line.startsWith("Repair attempts used:")) job.phase = "repairing";
            else if (line.startsWith("JSON:")) {
                job.reportPath = line.slice("JSON:".length).trim();
            } else if (line.startsWith("Report:")) {
                job.phase = "reporting";
                job.markdownPath = line.slice("Report:".length).trim();
            } else if (line.startsWith("Result:")) job.phase = line.includes("PASS") ? "completed" : "failed";
        }
    }

    async createSimple({ description, workspace = null, projectName = null, retryOf = null } = {}) {
        await this.initialize();
        const goal = cleanText(description, 12000);
        if (!goal) throw new Error("Describe what you want ForgePilot to build.");
        const allocated = await createSimpleBuildWorkspace(this.rootWorkspace ?? process.cwd(), { description: goal, projectName, workspace });
        const resolved = allocated.workspace;
        const id = crypto.randomBytes(8).toString("hex");
        const taskDir = path.join(resolved, ".forgepilot", "ui-tasks");
        await fs.mkdir(taskDir, { recursive: true });
        const taskPath = path.join(taskDir, `${id}.json`);
        const task = buildSimpleTask({ description: goal, machineConfig: this.machineConfig ?? {}, ollamaUrl: this.ollamaUrl, jobId: id });
        task.metadata = { ...(task.metadata ?? {}), retryOf };
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
        const taskId = createTaskId(taskPath, task);
        const preflight = await this.preflight({ workspace: resolved, goal });
        const job = {
            id, workspace: resolved, goal, effectiveGoal: goal, recipeId: null, recipeName: null, autonomy: "simple",
            approvals: ["file_write", "command_exec"], sandbox: false, status: "queued", phase: "queued", createdAt: new Date().toISOString(), startedAt: null, completedAt: null, exitCode: null,
            taskId, taskPath, reportPath: null, markdownPath: null, signed: false, retryOf, preflight, checkpoint: null, changeSet: null, rollback: null, patchReview: null, confidence: null, runtime: null,
            simpleBuild: true, projectName: allocated.projectName, watchdog: task.watchdog, lastActivityAt: null, log: allocated.created ? `Created project workspace: ${resolved}\n` : `Using existing project: ${resolved}\n`, child: null, error: null
        };
        this.jobs.set(id, job);
        await this.persist();
        this.drain();
        return this.publicJob(job);
    }

    async create({ workspace, goal, autonomy = null, approvals = undefined, sandbox = undefined, recipeId = null, retryOf = null }) {
        await this.initialize();
        const resolved = await ensureDirectory(workspace);
        const cleanGoal = cleanText(goal, 12000);
        if (!cleanGoal) throw new Error("Goal is required.");
        const recipe = recipeId && this.recipeStore ? await this.recipeStore.get(recipeId) : null;
        if (recipeId && !recipe) throw new Error(`Unknown recipe: ${recipeId}`);
        const selectedAutonomy = autonomy ?? recipe?.autonomy ?? "standard";
        const mode = AUTONOMY[selectedAutonomy] ?? AUTONOMY.standard;
        const grants = sanitizeApprovals(approvals, recipe?.approvals ?? ["file_write", "command_exec"]);
        const sandboxEnabled = sandbox === undefined ? Boolean(recipe?.sandbox) : Boolean(sandbox);
        const effectiveGoal = applyRecipe(recipe, cleanGoal);
        const preflight = await this.preflight({ workspace: resolved, goal: effectiveGoal });
        const id = crypto.randomBytes(8).toString("hex");
        const taskDir = path.join(resolved, ".forgepilot", "ui-tasks");
        await fs.mkdir(taskDir, { recursive: true });
        const taskPath = path.join(taskDir, `${id}.json`);
        const machine = this.machineConfig ?? {};
        const task = {
            goal: effectiveGoal,
            planner: "ollama",
            model: machine.model ?? "qwen2.5-coder:7b",
            modelFallbacks: machine.modelFallbacks ?? [],
            ...(this.ollamaUrl ? { ollamaUrl: this.ollamaUrl } : {}),
            maxContextTokens: Number(machine.maxContextTokens ?? 4000),
            maxRepairs: mode.maxRepairs ?? Number(machine.maxRepairs ?? 2),
            agentTeam: {
                enabled: mode.agentTeam ?? Boolean(machine.agentTeamEnabled),
                maxReviewRounds: mode.maxReviewRounds ?? Number(machine.maxReviewRounds ?? 1),
                requireVerifierApproval: true
            },
            permissions: { require: [...APPROVAL_CATEGORIES] },
            sandbox: sandboxEnabled ? { enabled: true, network: "none" } : { enabled: false },
            metadata: { createdBy: "forgepilot-dashboard", dashboardJobId: id, autonomy: selectedAutonomy, recipeId: recipe?.id ?? null, retryOf }
        };
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
        const taskId = createTaskId(taskPath, task);
        const job = {
            id, workspace: resolved, goal: cleanGoal, effectiveGoal, recipeId: recipe?.id ?? null, recipeName: recipe?.name ?? null,
            autonomy: selectedAutonomy, approvals: grants, sandbox: sandboxEnabled, status: "queued", phase: "queued", createdAt: new Date().toISOString(), startedAt: null,
            completedAt: null, exitCode: null, taskId, taskPath, reportPath: null, markdownPath: null, signed: false, retryOf,
            preflight, checkpoint: null, changeSet: null, rollback: null, patchReview: null, confidence: null, runtime: null,
            simpleBuild: false, projectName: null, watchdog: null, lastActivityAt: null, log: "", child: null, error: null
        };
        this.jobs.set(id, job);
        await this.persist();
        this.drain();
        return this.publicJob(job);
    }

    drain() {
        if (this.queuePaused) return;
        const running = [...this.jobs.values()].filter((job) => job.status === "running").length;
        let available = this.maxConcurrentJobs - running;
        if (available <= 0) return;
        const queued = [...this.jobs.values()].filter((job) => job.status === "queued").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        for (const job of queued) {
            if (available-- <= 0) break;
            this.start(job).catch(async (error) => {
                job.status = "failed";
                job.phase = "failed";
                job.error = error.message;
                job.completedAt = new Date().toISOString();
                await this.persist();
                this.drain();
            });
        }
    }

    async prepareAdaptiveRuntime(job) {
        if (!this.machineConfig?.adaptiveRuntime) return null;
        const health = await this.runtimeHealthBuilder({ machineConfig: this.machineConfig, baseUrl: this.ollamaUrl ?? "http://127.0.0.1:11434" });
        job.runtime = {
            checkedAt: health.checkedAt,
            status: health.status,
            tier: health.plan?.tier ?? null,
            model: health.plan?.model ?? null,
            modelFallbacks: health.plan?.modelFallbacks ?? [],
            resourcePressure: Boolean(health.plan?.resourcePressure),
            availableMemoryGiB: health.hardware?.availableMemoryGiB ?? null,
            warnings: health.warnings ?? []
        };
        if (health.blocked) throw new Error(health.warnings?.[0] ?? "Insufficient memory headroom for a local AI job.");
        const task = JSON.parse(await fs.readFile(job.taskPath, "utf8"));
        task.model = health.plan.model ?? task.model;
        task.modelFallbacks = health.plan.modelFallbacks ?? task.modelFallbacks ?? [];
        if (health.plan.maxContextTokens) task.maxContextTokens = Math.min(Number(task.maxContextTokens ?? health.plan.maxContextTokens), Number(health.plan.maxContextTokens));
        if (health.plan.maxRepairs != null) task.maxRepairs = Math.min(Number(task.maxRepairs ?? health.plan.maxRepairs), Number(health.plan.maxRepairs));
        if (task.agentTeam && typeof task.agentTeam === "object") {
            task.agentTeam.enabled = Boolean(task.agentTeam.enabled && health.plan.agentTeamEnabled !== false);
            if (health.plan.maxReviewRounds != null) task.agentTeam.maxReviewRounds = Math.min(Number(task.agentTeam.maxReviewRounds ?? health.plan.maxReviewRounds), Number(health.plan.maxReviewRounds));
        }
        task.metadata = { ...(task.metadata ?? {}), runtimeHealth: { checkedAt: health.checkedAt, tier: health.plan.tier, model: task.model, fallbackModels: task.modelFallbacks, resourcePressure: Boolean(health.plan.resourcePressure) } };
        await fs.writeFile(job.taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
        job.taskId = createTaskId(job.taskPath, task);
        this.append(job, `Adaptive runtime: ${health.status}; tier ${health.plan.tier}; model ${task.model}${task.modelFallbacks?.length ? `; fallbacks ${task.modelFallbacks.join(" -> ")}` : ""}\n`);
        return health;
    }

    async start(job) {
        if (job.status !== "queued") return;
        job.status = "running";
        job.phase = "checkpointing";
        job.startedAt = new Date().toISOString();
        job.completedAt = null;
        job.error = null;
        await this.persist();
        if (this.machineConfig?.adaptiveRuntime) {
            job.phase = "resource_check";
            await this.persist();
            try {
                await this.prepareAdaptiveRuntime(job);
            } catch (error) {
                job.status = "failed";
                job.phase = "resource_blocked";
                job.error = error.message;
                job.completedAt = new Date().toISOString();
                await this.persist();
                this.drain();
                return;
            }
        }
        job.phase = "checkpointing";
        await this.persist();
        try {
            const checkpoint = await createWorkspaceCheckpoint(job.workspace, job.id);
            job.checkpoint = { id: checkpoint.id, createdAt: checkpoint.createdAt, fileCount: checkpoint.fileCount, totalBytes: checkpoint.totalBytes, rollbackAvailable: false };
        } catch (error) {
            job.status = "failed";
            job.phase = "checkpoint_failed";
            job.error = error.message;
            job.completedAt = new Date().toISOString();
            await this.persist();
            this.drain();
            return;
        }
        job.phase = "starting";
        await this.persist();
        const args = [this.cliPath, "run", job.taskPath, "--workspace", job.workspace, "--planner", "ollama", "--apply"];
        if (job.approvals.length) args.push("--approve", job.approvals.join(","));
        if (job.sandbox) args.push("--sandbox");
        const child = this.spawner(this.nodePath, args, {
            cwd: job.workspace,
            env: { ...process.env },
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
        job.child = child;
        const taskForWatchdog = JSON.parse(await fs.readFile(job.taskPath, "utf8")).watchdog ?? {};
        const noProgressTimeoutMs = Math.max(this.watchdogFloorMs, Number(taskForWatchdog.noProgressTimeoutMs ?? (job.simpleBuild ? SIMPLE_BUILD_DEFAULTS.noProgressTimeoutMs : 600000)));
        const overallTimeoutMs = Math.max(this.watchdogFloorMs, Number(taskForWatchdog.overallTimeoutMs ?? (job.simpleBuild ? SIMPLE_BUILD_DEFAULTS.overallTimeoutMs : 3600000)));
        const childStartedAt = Date.now();
        let lastActivityAt = Date.now();
        let watchdogReason = null;
        const touch = (chunk) => { lastActivityAt = Date.now(); this.append(job, chunk); };
        child.stdout?.on("data", touch);
        child.stderr?.on("data", touch);
        child.on("error", (error) => {
            job.error = error.message;
            touch(`\nForgePilot launcher error: ${error.message}\n`);
        });
        const watchdogTimer = setInterval(() => {
            const now = Date.now();
            if (!watchdogReason && now - childStartedAt > overallTimeoutMs) watchdogReason = `Overall job limit reached (${Math.round(overallTimeoutMs / 60000)} minutes).`;
            if (!watchdogReason && now - lastActivityAt > noProgressTimeoutMs) watchdogReason = `No useful process output for ${Math.round(noProgressTimeoutMs / 60000)} minutes.`;
            if (watchdogReason) {
                this.append(job, `\nWATCHDOG STOP: ${watchdogReason} ForgePilot stopped the job instead of leaving it running indefinitely.\n`);
                try { child.kill("SIGKILL"); } catch { /* best effort */ }
            }
        }, this.watchdogPollMs);
        watchdogTimer.unref?.();
        await new Promise((resolve) => child.on("close", (code) => { job.exitCode = code ?? -1; resolve(); }));
        clearInterval(watchdogTimer);
        if (watchdogReason) job.error = watchdogReason;
        job.child = null;
        job.completedAt = new Date().toISOString();
        const wasCancelling = job.phase === "cancelling";
        let finalStatus = wasCancelling ? "cancelled" : (job.error && /job limit|No useful process output/i.test(job.error) ? "fail" : (job.exitCode === 0 && /Result:\s*PASS/.test(job.log) ? "pass" : "fail"));
        job.phase = "finalizing";
        if (!job.reportPath) {
            const match = job.log.match(/^JSON:\s*(.+)$/m);
            if (match) job.reportPath = match[1].trim();
        }
        if (!job.markdownPath) {
            const match = job.log.match(/^Report:\s*(.+)$/m);
            if (match) job.markdownPath = match[1].trim();
        }
        if (job.reportPath) {
            try {
                const verified = await verifyReportProvenance(job.reportPath);
                job.signed = Boolean(verified.passed);
            } catch { job.signed = false; }
        }
        try {
            const checkpoint = await finalizeWorkspaceCheckpoint(job.workspace, job.id);
            job.changeSet = {
                changedFiles: checkpoint.changes ?? [],
                summary: {
                    added: (checkpoint.changes ?? []).filter((item) => item.status === "added").length,
                    modified: (checkpoint.changes ?? []).filter((item) => item.status === "modified").length,
                    deleted: (checkpoint.changes ?? []).filter((item) => item.status === "deleted").length
                }
            };
            if (job.checkpoint) job.checkpoint.rollbackAvailable = (checkpoint.changes ?? []).length > 0;
            try {
                job.patchReview = await buildPatchReview(job.workspace, job.id);
            } catch (error) {
                job.patchReview = { version: 1, unavailable: true, error: error.message, summary: { fileCount: checkpoint.changes?.length ?? 0 } };
            }
            try {
                const report = job.reportPath ? JSON.parse(await fs.readFile(path.resolve(job.reportPath), "utf8")) : null;
                if (report) {
                    job.confidence = buildDashboardConfidence(report, {
                        signed: job.signed,
                        preflight: job.preflight,
                        changeSet: job.changeSet,
                        checkpoint: job.checkpoint,
                        patchReview: job.patchReview
                    });
                }
            } catch (error) {
                job.confidence = { score: 0, label: "low", unavailable: true, error: error.message };
            }
        } catch (error) {
            job.error = job.error ? `${job.error}; checkpoint finalization: ${error.message}` : `Checkpoint finalization: ${error.message}`;
            if (finalStatus === "pass") finalStatus = "fail";
        }
        job.status = finalStatus;
        job.phase = finalStatus === "pass" ? "completed" : finalStatus === "cancelled" ? "cancelled" : (job.error && /job limit|No useful process output/i.test(job.error) ? "watchdog_stopped" : "failed");
        await this.persist();
        this.drain();
    }

    async pause(id) {
        const job = this.jobs.get(String(id));
        if (!job || job.status !== "queued") return false;
        job.status = "paused";
        job.phase = "paused";
        await this.persist();
        return true;
    }

    async resume(id) {
        const job = this.jobs.get(String(id));
        if (!job || job.status !== "paused") return false;
        job.status = "queued";
        job.phase = "queued";
        await this.persist();
        this.drain();
        return true;
    }

    async retry(id) {
        const job = this.jobs.get(String(id));
        if (!job || ["queued", "running", "paused"].includes(job.status)) return null;
        if (job.simpleBuild) return this.createSimple({ description: job.goal, workspace: job.workspace, projectName: job.projectName, retryOf: job.id });
        return this.create({
            workspace: job.workspace,
            goal: job.goal,
            autonomy: job.autonomy,
            approvals: job.approvals,
            sandbox: job.sandbox,
            recipeId: job.recipeId,
            retryOf: job.id
        });
    }

    async setQueuePaused(value) {
        this.queuePaused = Boolean(value);
        await this.persist();
        if (!this.queuePaused) this.drain();
        return this.queueStatus();
    }

    cancel(id) {
        const job = this.jobs.get(String(id));
        if (!job) return false;
        if (job.status === "queued" || job.status === "paused") {
            job.status = "cancelled";
            job.phase = "cancelled";
            job.completedAt = new Date().toISOString();
            this.persist().catch(() => {});
            return true;
        }
        if (job.child && job.status === "running") {
            job.phase = "cancelling";
            job.child.kill("SIGTERM");
            this.persist().catch(() => {});
            return true;
        }
        return false;
    }

    async rollbackJob(id, { dryRun = false } = {}) {
        const job = this.jobs.get(String(id));
        if (!job || !job.checkpoint?.id || ["queued", "running", "paused"].includes(job.status)) return null;
        const result = await rollbackWorkspaceCheckpoint(job.workspace, job.checkpoint.id, { dryRun });
        if (!dryRun) {
            job.rollback = result;
            if (result.passed && job.checkpoint) job.checkpoint.rollbackAvailable = false;
            await this.persist();
        }
        return result;
    }

    async report(id) {
        const job = this.jobs.get(String(id));
        if (!job?.reportPath) return null;
        const resolved = path.resolve(job.reportPath);
        const relative = path.relative(job.workspace, resolved);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Report path is outside the job workspace.");
        return JSON.parse(await fs.readFile(resolved, "utf8"));
    }
}

export { AUTONOMY };
