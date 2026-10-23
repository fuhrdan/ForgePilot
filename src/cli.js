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
import { buildRepositoryContext } from "./repository/context.js";
import { createExecutionProvider, detectContainerRuntime, HostExecutionProvider } from "./sandbox/provider.js";
import { createSandboxSession } from "./sandbox/session.js";
import { OllamaVisionProvider } from "./visual/ollama.js";
import { decodePng } from "./visual/png.js";
import { compareImages } from "./visual/diff.js";

const VERSION = "0.6.0";

function usage() {
    console.log(`ForgePilot v${VERSION}\n\n` +
`Usage:\n` +
`  forgepilot init <workspace>\n` +
`  forgepilot doctor\n` +
`  forgepilot clone <git-url> <workspace>\n` +
`  forgepilot analyze [workspace] [--goal TEXT] [--max-context-tokens N]\n` +
`  forgepilot run <task.json> [--workspace PATH] [--planner scripted|ollama] [--model MODEL] [--ollama-url URL] [--vision-model MODEL] [--vision-url URL] [--max-repairs N] [--resume] [--sandbox] [--sandbox-runtime auto|docker|podman] [--sandbox-image IMAGE] [--sandbox-keep] [--apply]\n` +
`  forgepilot compare-images <actual.png> <baseline.png> [--channel-threshold N] [--max-changed-ratio N]\n\n` +
`Repository intelligence:\n` +
`  analyze detects ecosystems/frameworks, build/test hints, and the files selected for AI context.\n\n` +
`Visual verification (v0.6):\n` +
`  task.visual can capture PNG screenshots, compare baselines, probe pixels/regions, and optionally ask a local Ollama vision model for a verdict.\n` +
`  Checked-in visual baselines are frozen before implementation and cannot be modified by implementation/repair actions.\n\n` +
`Sandbox (v0.5+):\n` +
`  --sandbox runs build/test commands inside Docker/Podman against a disposable repository copy.\n` +
`  Network defaults to none; CPU/RAM/PID limits are enforced; verified changes are promoted on PASS only.\n\n` +
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
    const flags = new Set(["apply", "resume", "sandbox", "sandbox-keep"]);
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
    const tools = ["node", "git", "ollama", "npm", "python", "dotnet", "go", "java", "cargo", "godot", "godot4", "chromium", "google-chrome", "docker", "podman"];
    console.log(`ForgePilot v${VERSION} doctor\n`);
    for (const tool of tools) {
        const found = await commandExists(tool);
        console.log(`${found ? "[PASS]" : "[----]"} ${tool}`);
    }
    console.log(`\nNode runtime: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
    const sandboxRuntime = await detectContainerRuntime("auto");
    console.log(`Sandbox runtime: ${sandboxRuntime.available ? sandboxRuntime.runtime : "unavailable"}`);
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

function buildVisionProvider(task, options) {
    const provider = task.visual?.provider ?? {};
    const model = options["vision-model"] ?? provider.model;
    if (!model) return null;
    const type = String(provider.type ?? "ollama").toLowerCase();
    if (type !== "ollama") throw new Error(`Unsupported vision provider: ${type}`);
    return new OllamaVisionProvider({
        model,
        baseUrl: options["vision-url"] ?? provider.baseUrl ?? "http://127.0.0.1:11434"
    });
}


function repositoryReportSummary(repository) {
    if (!repository) return null;
    return {
        scan: repository.scan,
        projects: repository.projects,
        commandHints: repository.commandHints,
        budget: repository.budget,
        testing: repository.testing ? {
            testFileCount: repository.testing.testFileCount,
            selectedTests: repository.testing.selectedTests,
            primaryTestCommand: repository.testing.primaryTestCommand,
            targetedTestCommand: repository.testing.targetedTestCommand,
            regressionCommand: repository.testing.regressionCommand,
            buildCommands: repository.testing.buildCommands
        } : null,
        selectedFiles: (repository.selectedFiles ?? []).map(({ path, score }) => ({ path, score }))
    };
}

async function runTask(taskFile, options) {
    const taskPath = path.resolve(taskFile);
    const task = JSON.parse(await fs.readFile(taskPath, "utf8"));
    const originalWorkspace = await ensureWorkspace(options.workspace ?? task.workspace ?? path.dirname(taskPath));
    await initializeWorkspace(originalWorkspace);

    const plannerName = options.planner ?? task.planner ?? "scripted";
    const planner = buildPlanner(plannerName, task, options);
    const visionProvider = buildVisionProvider(task, options);
    const taskId = createTaskId(taskPath, task);
    const maxRepairs = Math.max(0, Number(options["max-repairs"] ?? task.maxRepairs ?? 2));
    if (!Number.isFinite(maxRepairs)) throw new Error("--max-repairs must be a number.");

    const rawSandbox = task.sandbox === true ? {} : (task.sandbox && typeof task.sandbox === "object" ? task.sandbox : {});
    const sandboxEnabled = Boolean(options.sandbox || task.sandbox === true || rawSandbox.enabled === true);
    if (sandboxEnabled && options.resume) throw new Error("Sandbox resume is not supported in v0.5; rerun the task in a fresh disposable sandbox or use host mode with --resume.");

    let sandboxSession = null;
    let workingWorkspace = originalWorkspace;
    let executionProvider = new HostExecutionProvider();
    let sandboxInfo = { enabled: sandboxEnabled, provider: executionProvider.describe(), promoted: false, promotedChanges: [], artifacts: [], visualEvidence: [] };

    if (sandboxEnabled && options.apply) {
        sandboxSession = await createSandboxSession(originalWorkspace, {
            taskId,
            keep: Boolean(options["sandbox-keep"] || rawSandbox.keep)
        });
        workingWorkspace = sandboxSession.workspace;
        executionProvider = await createExecutionProvider({
            enabled: true,
            runtime: options["sandbox-runtime"] ?? rawSandbox.runtime ?? "auto",
            workspaceRoot: workingWorkspace,
            image: options["sandbox-image"] ?? rawSandbox.image ?? "node:22-bookworm",
            network: rawSandbox.network ?? "none",
            cpus: rawSandbox.cpus ?? "2",
            memory: rawSandbox.memory ?? "2g",
            pidsLimit: rawSandbox.pidsLimit ?? 256,
            pullPolicy: rawSandbox.pullPolicy ?? "never"
        });
        sandboxInfo.provider = executionProvider.describe();
        sandboxInfo.workspace = workingWorkspace;
    }

    let resumeState = null;
    if (options.resume) {
        resumeState = await loadState(originalWorkspace, taskId);
        if (!resumeState) throw new Error(`No checkpoint exists for task ${taskId}.`);
    }

    console.log(`ForgePilot v${VERSION}`);
    console.log(`Goal: ${task.goal ?? "(no goal supplied)"}`);
    console.log(`Workspace: ${originalWorkspace}`);
    console.log(`Planner: ${plannerName}`);
    console.log(`Repair budget: ${maxRepairs}`);
    if (sandboxEnabled) console.log(`Sandbox: ${options.apply ? `${sandboxInfo.provider.runtime ?? "planned"} / ${sandboxInfo.provider.image ?? rawSandbox.image ?? "node:22-bookworm"}` : "planned"}`);
    console.log(`Mode: ${options.apply ? "APPLY" : "PLAN ONLY"}${options.resume ? " / RESUME" : ""}\n`);

    let outcome;
    let status = "FAIL";
    try {
        outcome = await runTaskWithRepairs({
            task,
            planner,
            plannerName,
            workspace: workingWorkspace,
            apply: Boolean(options.apply),
            maxRepairs,
            taskId,
            resumeState,
            executionProvider,
            visionProvider
        });

        console.log(`Plan rationale: ${outcome.plan.rationale ?? "(none)"}`);
        console.log(`Actions: ${outcome.plan.actions.length}; verification checks: ${outcome.plan.verify.length}`);
        if (outcome.repairCount > 0) console.log(`Repair attempts used: ${outcome.repairCount}/${maxRepairs}`);
        console.log("");

        const actionFailure = outcome.actions.some((item) => item.status === "failed") && !outcome.verification.passed;
        status = !options.apply ? "PLANNED" : (!actionFailure && outcome.verification.passed ? "PASS" : "FAIL");

        if (sandboxSession) {
            const visualArtifacts = Array.isArray(outcome.visual?.evidencePaths) ? outcome.visual.evidencePaths : [];
            sandboxInfo.visualEvidence = await sandboxSession.exportEvidence(visualArtifacts);
            sandboxInfo.artifacts = await sandboxSession.exportArtifacts(Array.isArray(rawSandbox.artifacts) ? rawSandbox.artifacts : []);
            if (status === "PASS") {
                sandboxInfo.promotedChanges = await sandboxSession.promote();
                sandboxInfo.promoted = true;
            }
        }

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
            verification: outcome.verification,
            repository: repositoryReportSummary(outcome.repository),
            testFirst: outcome.testFirst,
            coverage: outcome.coverage,
            visual: outcome.visual ?? outcome.verification.visual ?? null,
            visionProvider: visionProvider?.describe?.() ?? null,
            sandbox: sandboxInfo
        };

        const artifacts = await writeReport(originalWorkspace, report);
        console.log(`Result: ${status}`);
        if (sandboxEnabled && options.apply) console.log(`Sandbox promotion: ${sandboxInfo.promoted ? `PASS (${sandboxInfo.promotedChanges.length} file change(s))` : "NOT PROMOTED"}`);
        console.log(`Report: ${artifacts.markdownPath}`);
        console.log(`JSON:   ${artifacts.jsonPath}`);

        if (status === "FAIL") process.exitCode = 2;
    } finally {
        if (sandboxSession) await sandboxSession.close({ preserve: Boolean(options["sandbox-keep"] || rawSandbox.keep) && status !== "PASS" });
    }
}


async function analyzeRepository(workspaceArg, options) {
    const workspace = await ensureWorkspace(workspaceArg ?? ".");
    const maxContextTokens = Math.max(250, Number(options["max-context-tokens"] ?? 6000));
    if (!Number.isFinite(maxContextTokens)) throw new Error("--max-context-tokens must be a number.");
    const repository = await buildRepositoryContext(workspace, {
        goal: options.goal ?? "",
        maxContextTokens
    });

    console.log(`ForgePilot v${VERSION} repository analysis`);
    console.log(`Workspace: ${workspace}`);
    console.log(`Files: ${repository.scan.fileCount}${repository.scan.truncated ? "+" : ""} (${repository.scan.source})`);
    console.log(`Context: ~${repository.budget.approxTokensUsed}/${repository.budget.maxTokens} tokens across ${repository.budget.selectedFileCount} files\n`);

    console.log("Detected projects:");
    for (const project of repository.projects) {
        const frameworks = project.frameworks?.length ? ` [${project.frameworks.join(", ")}]` : "";
        console.log(`  - ${project.ecosystem}: ${project.language}${frameworks}`);
    }

    console.log("\nSuggested commands:");
    if (!repository.commandHints.length) console.log("  (none)");
    for (const hint of repository.commandHints) console.log(`  - ${hint.kind}: ${hint.command} ${(hint.args ?? []).join(" ")}`.trimEnd());

    console.log("\nTesting:");
    console.log(`  - Test files: ${repository.testing?.testFileCount ?? 0}`);
    console.log(`  - Selected tests: ${(repository.testing?.selectedTests ?? []).join(", ") || "(none)"}`);
    if (repository.testing?.targetedTestCommand) console.log(`  - Targeted gate: ${repository.testing.targetedTestCommand.command} ${(repository.testing.targetedTestCommand.args ?? []).join(" ")}`.trimEnd());
    if (repository.testing?.primaryTestCommand) console.log(`  - Regression gate: ${repository.testing.primaryTestCommand.command} ${(repository.testing.primaryTestCommand.args ?? []).join(" ")}`.trimEnd());

    console.log("\nSelected AI context:");
    if (!repository.selectedFiles.length) console.log("  (none)");
    for (const file of repository.selectedFiles) console.log(`  - ${file.path} (score ${file.score})`);
}

async function compareImagesCommand(actualArg, baselineArg, options) {
    if (!actualArg || !baselineArg) throw new Error("compare-images requires <actual.png> <baseline.png>.");
    const actual = await decodePng(path.resolve(actualArg));
    const baseline = await decodePng(path.resolve(baselineArg));
    const metrics = compareImages(actual, baseline, { channelThreshold: Number(options["channel-threshold"] ?? 0) });
    const maxChangedRatio = Number(options["max-changed-ratio"] ?? 0);
    const passed = metrics.comparable && metrics.changedRatio <= maxChangedRatio;
    console.log(`ForgePilot v${VERSION} visual comparison`);
    console.log(`Actual:   ${path.resolve(actualArg)} (${actual.width}x${actual.height})`);
    console.log(`Baseline: ${path.resolve(baselineArg)} (${baseline.width}x${baseline.height})`);
    console.log(`Comparable: ${metrics.comparable ? "yes" : "no"}`);
    console.log(`Changed pixels: ${metrics.changedPixels ?? "n/a"}/${metrics.totalPixels ?? "n/a"}`);
    console.log(`Changed ratio: ${metrics.changedRatio}`);
    console.log(`Mean delta: ${metrics.meanDelta}`);
    console.log(`RMS delta: ${metrics.rmsDelta}`);
    console.log(`Result: ${passed ? "PASS" : "FAIL"}`);
    if (!passed) process.exitCode = 2;
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

    if (command === "analyze") {
        const { options, positionals } = parseOptions(rest);
        return analyzeRepository(positionals[0] ?? ".", options);
    }

    if (command === "compare-images") {
        const { options, positionals } = parseOptions(rest);
        return compareImagesCommand(positionals[0], positionals[1], options);
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
