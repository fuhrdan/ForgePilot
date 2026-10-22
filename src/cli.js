#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { ScriptedPlanner } from "./planners/scripted.js";
import { OllamaPlanner } from "./planners/ollama.js";
import { executePlan } from "./actions/executor.js";
import { verifyPlan } from "./verification/verifier.js";
import { initializeWorkspace, ensureWorkspace, getGitStatus, summarizeWorkspace } from "./core/workspace.js";
import { commandExists, runCommand } from "./core/command.js";
import { writeReport } from "./report.js";

const VERSION = "0.1.0";

function usage() {
    console.log(`ForgePilot v${VERSION}\n\n` +
`Usage:\n` +
`  forgepilot init <workspace>\n` +
`  forgepilot doctor\n` +
`  forgepilot clone <git-url> <workspace>\n` +
`  forgepilot run <task.json> [--workspace PATH] [--planner scripted|ollama] [--model MODEL] [--ollama-url URL] [--apply]\n\n` +
`Safety:\n` +
`  AI-generated actions are plan-only unless --apply is explicitly supplied.\n` +
`  Commands run without a shell and must be on ForgePilot's executable allowlist.\n` +
`  File writes are constrained to the selected workspace.\n`);
}

function parseOptions(args) {
    const options = {};
    const positionals = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--apply") options.apply = true;
        else if (arg.startsWith("--")) {
            const key = arg.slice(2);
            const value = args[++i];
            if (value === undefined) throw new Error(`Missing value for ${arg}`);
            options[key] = value;
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

async function runTask(taskFile, options) {
    const taskPath = path.resolve(taskFile);
    const task = JSON.parse(await fs.readFile(taskPath, "utf8"));
    const workspace = await ensureWorkspace(options.workspace ?? task.workspace ?? path.dirname(taskPath));
    await initializeWorkspace(workspace);

    const git = await getGitStatus(workspace);
    const files = await summarizeWorkspace(workspace);
    const plannerName = options.planner ?? task.planner ?? "scripted";
    let planner;

    if (plannerName === "ollama") {
        planner = new OllamaPlanner({
            model: options.model ?? task.model ?? "qwen2.5-coder:7b",
            baseUrl: options["ollama-url"] ?? task.ollamaUrl ?? "http://127.0.0.1:11434"
        });
    } else if (plannerName === "scripted") {
        planner = new ScriptedPlanner();
    } else {
        throw new Error(`Unknown planner: ${plannerName}`);
    }

    console.log(`ForgePilot v${VERSION}`);
    console.log(`Goal: ${task.goal ?? "(no goal supplied)"}`);
    console.log(`Workspace: ${workspace}`);
    console.log(`Planner: ${plannerName}`);
    console.log(`Mode: ${options.apply ? "APPLY" : "PLAN ONLY"}\n`);

    const plan = await planner.plan(task, { workspace, git, files });
    console.log(`Plan rationale: ${plan.rationale ?? "(none)"}`);
    console.log(`Actions: ${plan.actions.length}; verification checks: ${plan.verify.length}\n`);

    const actions = await executePlan(plan, workspace, { apply: Boolean(options.apply) });
    const actionFailure = actions.some((item) => item.status === "failed");
    const verification = actionFailure
        ? { passed: false, checks: [], git: await getGitStatus(workspace), skipped: "action failure" }
        : await verifyPlan(plan, workspace, { apply: Boolean(options.apply) });

    const status = !options.apply ? "PLANNED" : (!actionFailure && verification.passed ? "PASS" : "FAIL");
    const report = {
        version: VERSION,
        createdAt: new Date().toISOString(),
        goal: plan.goal ?? task.goal,
        planner: plannerName,
        apply: Boolean(options.apply),
        status,
        plan,
        actions,
        verification
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
