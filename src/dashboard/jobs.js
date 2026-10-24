import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRepositoryContext } from "../repository/context.js";
import { createTaskId } from "../core/state.js";
import { verifyReportProvenance } from "../security/provenance.js";
import { APPROVAL_CATEGORIES } from "../security/approvals.js";

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

function sanitizeApprovals(items) {
    const list = Array.isArray(items) ? items : [];
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

export class DashboardJobManager {
    constructor({ machineConfig = null, nodePath = process.execPath, cliPath = DEFAULT_CLI, spawner = spawn, maxLogChars = 120000, ollamaUrl = null } = {}) {
        this.machineConfig = machineConfig;
        this.nodePath = nodePath;
        this.cliPath = cliPath;
        this.spawner = spawner;
        this.maxLogChars = maxLogChars;
        this.ollamaUrl = ollamaUrl;
        this.jobs = new Map();
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

    publicJob(job) {
        return {
            id: job.id,
            workspace: job.workspace,
            goal: job.goal,
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
            log: job.log,
            error: job.error ?? null
        };
    }

    append(job, text) {
        job.log = `${job.log}${String(text)}`.slice(-this.maxLogChars);
        const lines = job.log.split(/\r?\n/).slice(-40);
        for (const line of lines) {
            if (line.startsWith("Plan rationale:")) job.phase = "planned";
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

    async create({ workspace, goal, autonomy = "standard", approvals = ["file_write", "command_exec"], sandbox = false }) {
        const resolved = await ensureDirectory(workspace);
        const cleanGoal = cleanText(goal);
        if (!cleanGoal) throw new Error("Goal is required.");
        const mode = AUTONOMY[autonomy] ?? AUTONOMY.standard;
        const grants = sanitizeApprovals(approvals);
        const id = crypto.randomBytes(8).toString("hex");
        const taskDir = path.join(resolved, ".forgepilot", "ui-tasks");
        await fs.mkdir(taskDir, { recursive: true });
        const taskPath = path.join(taskDir, `${id}.json`);
        const machine = this.machineConfig ?? {};
        const task = {
            goal: cleanGoal,
            planner: "ollama",
            model: machine.model ?? "qwen2.5-coder:7b",
            ...(this.ollamaUrl ? { ollamaUrl: this.ollamaUrl } : {}),
            maxContextTokens: Number(machine.maxContextTokens ?? 4000),
            maxRepairs: mode.maxRepairs ?? Number(machine.maxRepairs ?? 2),
            agentTeam: {
                enabled: mode.agentTeam ?? Boolean(machine.agentTeamEnabled),
                maxReviewRounds: mode.maxReviewRounds ?? Number(machine.maxReviewRounds ?? 1),
                requireVerifierApproval: true
            },
            permissions: { require: [...APPROVAL_CATEGORIES] },
            sandbox: sandbox ? { enabled: true, network: "none" } : { enabled: false },
            metadata: { createdBy: "forgepilot-dashboard", dashboardJobId: id, autonomy }
        };
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2) + "\n", "utf8");
        const taskId = createTaskId(taskPath, task);
        const job = {
            id, workspace: resolved, goal: cleanGoal, autonomy, approvals: grants, sandbox: Boolean(sandbox),
            status: "queued", phase: "queued", createdAt: new Date().toISOString(), startedAt: null,
            completedAt: null, exitCode: null, taskId, taskPath, reportPath: null, markdownPath: null, signed: false, log: "", child: null
        };
        this.jobs.set(id, job);
        this.start(job).catch((error) => {
            job.status = "failed";
            job.phase = "failed";
            job.error = error.message;
            job.completedAt = new Date().toISOString();
        });
        return this.publicJob(job);
    }

    async start(job) {
        job.status = "running";
        job.phase = "starting";
        job.startedAt = new Date().toISOString();
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
        child.stdout?.on("data", (chunk) => this.append(job, chunk));
        child.stderr?.on("data", (chunk) => this.append(job, chunk));
        child.on("error", (error) => {
            job.error = error.message;
            this.append(job, `\nForgePilot launcher error: ${error.message}\n`);
        });
        await new Promise((resolve) => child.on("close", (code) => { job.exitCode = code ?? -1; resolve(); }));
        job.child = null;
        job.completedAt = new Date().toISOString();
        job.status = job.exitCode === 0 && /Result:\s*PASS/.test(job.log) ? "pass" : "fail";
        job.phase = job.status === "pass" ? "completed" : "failed";
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
    }

    cancel(id) {
        const job = this.jobs.get(String(id));
        if (!job) return false;
        if (job.child && job.status === "running") {
            job.child.kill("SIGTERM");
            job.phase = "cancelling";
            return true;
        }
        return false;
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
