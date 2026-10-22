#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { ScriptedPlanner } from "./planners/scripted.js";
import { OllamaPlanner } from "./planners/ollama.js";
import { initializeWorkspace, ensureWorkspace } from "./core/workspace.js";
import { commandExists, runCommand } from "./core/command.js";
import { createTaskId, loadState } from "./core/state.js";
import { runTaskWithRepairs } from "./orchestration/repair-loop.js";
import { writeReport } from "./report.js";

const VERSION = "0.2.0";

function usage() {
    console.log(`ForgePilot v${VERSION}\n\n` +
`Usage:\n` +
`  forgepilot init <workspace>\n` +
`  forgepilot doctor\n` +
`  forgepilot clone <git-url> <workspace>\n` +
`  forgepilot run <task.json> [--workspace PATH] [--planner scripted|ollama] [--model MODEL] [--ollama-url URL] [--max-repairs N] [--resume] [--apply]\n\n` +
`Repair loop:\n` +
`  Failed actions and verification checks can trigger bounded evidence-driven repairs.\n` +
`  --max-repairs defaults to 2. --resume continues from the task checkpoint.\n\n` +
`Safety:\n` +
`  AI-generated actions are plan-only unless --apply is explicitly supplied.\n` +
`  Commands run without a shell and must be on ForgePilot's executable allowlist.\n` +
`  File writes and patches are constrained to the selected workspace.\n`);
}

function parseOptions(args) {
    const options = {};
    const positionals = [];
    const flags = new Set(["apply", "resume"]);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            if (flags.has(key)) options[key] = true;
            else {
                const value = args[++i];
                if (value === undefined) throw new Error(`Missing value for ${arg}`);
                options[key] = value;
            }
        } else positionals.push(arg);
    }
    return { options, positionals };
}

async function doctor() {
    const tools = ["node", "git", "ollama", "npm", "python", "dotnet", "go", "java", "cargo"];
    console.log(`ForgePilot v${VERSION} doctor\n`);
    for (const tool of tools) {
        const found = await commandExists(tool);
        console.log(`${found ? "[PASS]" : "[----]"} ${tool}`);
    }
    console.log(`\nNode runtime: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
}

async function cloneRepository(url, workspace) {
    const parent = path.dirname(path.resolve(workspace));
    await fs.mkdir(parent, { recursive: true });
    const result = await runCommand({ command: "git", args: ["clone", "--", url, path.resolve(workspace)], cwd: parent, timeoutMs: 300000 });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.exitCode !== 0) process.exitCode = 1;
    else await initializeWorkspace(workspace);
}

function buildPlanner(plannerName, task, options) {
    if (plannerName === "ollama") {
        return new OllamaPlanner({
            model: options.model ?? task.model ?? "qwen2.5-coder:7b",
            baseUrl: options["ollama-url"] ?? task.ollamaUrl ?? "http://127.0.0.1:11434"
        });
    }
    if (plannerName === "scripted") return new ScriptedPlanner();
    throw new Error(`Unknown planner: ${plannerName}`);
}

async function runTask(taskFile, options) {
    const taskPath = path.resolve(taskFile);
    const task = JSON.parse(await fs.readFile(taskPath, "utf8"));
    const workspace = await ensureWorkspace(options.workspace ?? task.workspace ?? path.dirname(taskPath));
    await initializeWorkspace(workspace);

    const plannerName = options.planner ?? task.planner ?? "scripted";
    const planner = buildPlanner(plannerName, task, options);
    const taskId = createTaskId(taskPath, task);
    const maxRepairs = Math.max(0, Number(options["max-repairs"] ?? task.maxRepairs ?? 2));
    if (!Number.isFinite(maxRepairs)) throw new Error("--max-repairs must be a number.");

    let resumeState = null;
    if (options.resume) {
        resumeState = await loadState(workspace, taskId);
        if (!resumeState) throw new Error(`No checkpoint exists for task ${taskId}.`);
    }

    console.log(`ForgePilot v${VERSION}`);
    console.log(`Goal: ${task.goal ?? "(no goal supplied)"}`);
    console.log(`Workspace: ${workspace}`);
    console.log(`Planner: ${plannerName}`);
    console.log(`Repair budget: ${maxRepairs}`);
    console.log(`Mode: ${options.apply ? "APPLY" : "PLAN ONLY"}${options.resume ? " / RESUME" : ""}\n`);

    const outcome = await runTaskWithRepairs({
        task,
        planner,
        plannerName,
        workspace,
        apply: Boolean(options.apply),
        maxRepairs,
        taskId,
        resumeState
    });

    console.log(`Plan rationale: ${outcome.plan.rationale ?? "(none)"}`);
    console.log(`Actions: ${outcome.plan.actions.length}; verification checks: ${outcome.plan.verify.length}`);
    if (outcome.repairCount > 0) console.log(`Repair attempts used: ${outcome.repairCount}/${maxRepairs}`);
    console.log("");

    const actionFailure = outcome.actions.some((item) => item.status === "failed") && !outcome.verification.passed;
    const status = !options.apply ? "PLANNED" : (!actionFailure && outcome.verification.passed ? "PASS" : "FAIL");
    const report = {
        version: VERSION,
        createdAt: new Date().toISOString(),
        taskId,
        goal: outcome.plan.goal ?? task.goal,
        planner: plannerName,
        apply: Boolean(options.apply),
        status,
        plan: outcome.plan,
        actions: outcome.actions,
        repairs: outcome.repairs,
        repairCount: outcome.repairCount,
        maxRepairs,
        resumed: outcome.resumed,
        verification: outcome.verification
    };

    const artifacts = await writeReport(workspace, report);
    console.log(`Result: ${status}`);
    console.log(`Report: ${artifacts.markdownPath}`);
    console.log(`JSON:   ${artifacts.jsonPath}`);

    if (status === "FAIL") process.exitCode = 2;
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || ["help", "--help", "-h"].includes(command)) return usage();
    if (["version", "--version", "-v"].includes(command)) return console.log(VERSION);
    if (command === "doctor") return doctor();

    if (command === "init") {
        const workspace = rest[0];
        if (!workspace) throw new Error("init requires <workspace>.");
        const resolved = await initializeWorkspace(workspace);
        console.log(`Initialized ForgePilot workspace: ${resolved}`);
        return;
    }

    if (command === "clone") {
        const [url, workspace] = rest;
        if (!url || !workspace) throw new Error("clone requires <git-url> <workspace>.");
        return cloneRepository(url, workspace);
    }

    if (command === "run") {
        const { options, positionals } = parseOptions(rest);
        const taskFile = positionals[0];
        if (!taskFile) throw new Error("run requires <task.json>.");
        return runTask(taskFile, options);
    }

    throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
    console.error(`ForgePilot error: ${error.message}`);
    if (process.env.FORGEPILOT_DEBUG === "1") console.error(error.stack);
    process.exitCode = 1;
});
