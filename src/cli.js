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
import { AgentTeam } from "./agents/team.js";
import { createComputerSession } from "./computer/factory.js";
import { SecretStore } from "./security/secrets.js";
import { ApprovalManager } from "./security/approvals.js";
import { resolveProfile, detectHardware, recommendProfile } from "./product/profiles.js";
import { RecoveryJournal, listRecoveryJournals } from "./product/recovery.js";
import { signReport, verifyReportProvenance } from "./security/provenance.js";
import { createDashboardServer } from "./dashboard/server.js";
import { inspectSystem, recommendMachinePlan, saveMachineConfig, loadMachineConfig, writeLauncherEnvironment, machineConfigPath } from "./product/system-inspector.js";
import { launchForgePilot } from "./product/launcher.js";
import { buildPreflight } from "./repository/preflight.js";
import { rollbackWorkspaceCheckpoint } from "./repository/checkpoint.js";

const VERSION = "0.13.0";

function usage() {
    console.log(`ForgePilot v${VERSION}\n\n` +
`Usage:\n` +
`  forgepilot init <workspace>\n` +
`  forgepilot doctor\n` +
`  forgepilot setup [--json]\n` +
`  forgepilot launch [workspace] [--port N] [--no-browser]\n` +
`  forgepilot profile [auto|low-resource|balanced|high-quality]\n` +
`  forgepilot recover [workspace]\n` +
`  forgepilot dashboard [workspace] [--port N]\n` +
`  forgepilot verify-run <report.json> [--public-key PATH]\n` +
`  forgepilot clone <git-url> <workspace>\n` +
`  forgepilot analyze [workspace] [--goal TEXT] [--max-context-tokens N]\n` +
`  forgepilot preflight [workspace] --goal TEXT\n` +
`  forgepilot rollback <workspace> <checkpoint-id> [--dry-run]\n` +
`  forgepilot run <task.json> [--workspace PATH] [--planner scripted|ollama] [--model MODEL] [--ollama-url URL] [--vision-model MODEL] [--vision-url URL] [--max-repairs N] [--agents|--no-agents] [--max-review-rounds N] [--implementer-model MODEL] [--debugger-model MODEL] [--reviewer-model MODEL] [--verifier-model MODEL] [--resume] [--computer] [--computer-driver cdp|replay|windows-ui] [--computer-endpoint URL] [--computer-target TEXT] [--sandbox] [--sandbox-runtime auto|docker|podman] [--sandbox-image IMAGE] [--sandbox-keep] [--profile NAME] [--approve CATEGORIES] [--approve-all] [--apply]\n` +
`  forgepilot compare-images <actual.png> <baseline.png> [--channel-threshold N] [--max-changed-ratio N]\n\n` +
`Repository intelligence:\n` +
`  analyze detects ecosystems/frameworks, build/test hints, and the files selected for AI context.\n\n` +
`Local control center (v0.13):\n` +
`  setup inspects RAM/CPU/GPU/disk/tools and persists safe machine defaults; launch starts the local control center in a browser.
  The dashboard can analyze repositories and start/cancel verified jobs with explicit capability grants.\n` +
`  Windows release includes INSTALL_FORGEPILOT.cmd and RUN_FORGEPILOT.cmd for double-click install/run.\n\n` +
`Product hardening (v0.9+):\n` +
`  Optional permission categories, environment-backed secrets, recovery journals, signed provenance, hardware/model profiles, local dashboard, and native Windows UI Automation.\n` +
`  --approve accepts comma-separated required categories; --approve-all grants all task-required categories.\n\n` +
`Computer / IDE control (v0.8+):\n` +
`  task.computer enables persistent CDP/replay GUI sessions with accessibility inspection, clicks, typing, keys, screenshots, and replayable traces.\n` +
`  Navigation is localhost-only by default unless task.computer.allowedOrigins explicitly expands it.\n\n` +
`Multi-agent engineering (v0.7+):\n` +
`  Planner, Implementer, Debugger, Reviewer, and Verifier roles exchange structured evidence.\n` +
`  Reviewer/Verifier are read-only; use --agents to enable for scripted tasks or --no-agents to disable the default Ollama team.\n\n` +
`Visual verification (v0.6+):\n` +
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
    const flags = new Set(["apply", "resume", "computer", "sandbox", "sandbox-keep", "agents", "no-agents", "approve-all", "json", "no-browser", "dry-run"]);
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
    const tools = ["node", "git", "ollama", "npm", "python", "dotnet", "go", "java", "cargo", "godot", "godot4", "chromium", "google-chrome", "msedge", "code", "codium", "powershell", "pwsh", "docker", "podman"];
    console.log(`ForgePilot v${VERSION} doctor\n`);
    for (const tool of tools) {
        const found = await commandExists(tool);
        console.log(`${found ? "[PASS]" : "[----]"} ${tool}`);
    }
    console.log(`\nNode runtime: ${process.version}`);
    console.log(`Platform: ${process.platform} ${process.arch}`);
    const sandboxRuntime = await detectContainerRuntime("auto");
    console.log(`Sandbox runtime: ${sandboxRuntime.available ? sandboxRuntime.runtime : "unavailable"}`);
    const hardware = detectHardware();
    console.log(`Hardware: ${hardware.memoryGiB} GiB RAM, ${hardware.logicalCpus} logical CPUs`);
    console.log(`Recommended profile: ${recommendProfile(hardware)}`);
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
    const rawTask = JSON.parse(await fs.readFile(taskPath, "utf8"));
    const machineConfig = await loadMachineConfig().catch(() => null);
    const explicitProfile = options.profile ?? rawTask.profile ?? null;
    const selectedProfileName = explicitProfile ?? process.env.FORGEPILOT_PROFILE ?? machineConfig?.profile ?? null;
    const profile = selectedProfileName ? resolveProfile(selectedProfileName) : null;
    const useMachineDefaults = !explicitProfile && machineConfig;
    const defaultContext = useMachineDefaults?.maxContextTokens ?? profile?.maxContextTokens;
    const task = defaultContext ? { ...rawTask, maxContextTokens: rawTask.maxContextTokens ?? defaultContext } : rawTask;
    const configuredVisionModel = useMachineDefaults && Object.prototype.hasOwnProperty.call(useMachineDefaults, "visionModel")
        ? useMachineDefaults.visionModel
        : profile?.visionModel;
    const effectiveOptions = (profile || useMachineDefaults) ? {
        ...options,
        model: options.model ?? task.model ?? process.env.FORGEPILOT_MODEL ?? useMachineDefaults?.model ?? profile?.model,
        "vision-model": options["vision-model"] ?? task.visual?.provider?.model ?? configuredVisionModel
    } : options;
    const originalWorkspace = await ensureWorkspace(options.workspace ?? task.workspace ?? path.dirname(taskPath));
    await initializeWorkspace(originalWorkspace);
    const secretStore = new SecretStore(task.secrets ?? {});
    const approvalManager = new ApprovalManager(task.permissions ?? {}, { grants: options.approve ?? [], approveAll: Boolean(options["approve-all"]) });

    const plannerName = options.planner ?? task.planner ?? "scripted";
    const planner = buildPlanner(plannerName, task, effectiveOptions);
    const rawAgentTeam = task.agentTeam === true ? {} : (task.agentTeam && typeof task.agentTeam === "object" ? task.agentTeam : {});
    const agentsEnabled = options["no-agents"]
        ? false
        : Boolean(options.agents || rawAgentTeam.enabled === true || (plannerName === "ollama" && rawAgentTeam.enabled !== false && useMachineDefaults?.agentTeamEnabled !== false));
    const maxReviewRounds = Math.max(0, Number(options["max-review-rounds"] ?? rawAgentTeam.maxReviewRounds ?? useMachineDefaults?.maxReviewRounds ?? profile?.maxReviewRounds ?? 2));
    if (!Number.isFinite(maxReviewRounds)) throw new Error("--max-review-rounds must be a number.");
    const roleAdapters = {};
    if (agentsEnabled && plannerName === "ollama") {
        const roleModels = rawAgentTeam.models ?? {};
        const baseUrl = effectiveOptions["ollama-url"] ?? task.ollamaUrl ?? "http://127.0.0.1:11434";
        const fallbackModel = effectiveOptions.model ?? task.model ?? "qwen2.5-coder:7b";
        const modelFor = (role, optionName) => effectiveOptions[optionName] ?? roleModels[role] ?? fallbackModel;
        roleAdapters.planner = new OllamaPlanner({ model: modelFor("planner", "model"), baseUrl });
        roleAdapters.implementer = new OllamaPlanner({ model: modelFor("implementer", "implementer-model"), baseUrl });
        roleAdapters.debugger = new OllamaPlanner({ model: modelFor("debugger", "debugger-model"), baseUrl });
        roleAdapters.reviewer = new OllamaPlanner({ model: modelFor("reviewer", "reviewer-model"), baseUrl });
        roleAdapters.verifier = new OllamaPlanner({ model: modelFor("verifier", "verifier-model"), baseUrl });
    }
    const agentTeam = new AgentTeam({
        adapter: planner,
        adapters: roleAdapters,
        enabled: agentsEnabled,
        maxReviewRounds,
        requireVerifierApproval: rawAgentTeam.requireVerifierApproval !== false
    });
    const visionProvider = buildVisionProvider(task, effectiveOptions);
    const taskId = createTaskId(taskPath, task);
    const recovery = new RecoveryJournal(originalWorkspace, taskId);
    const maxRepairs = Math.max(0, Number(options["max-repairs"] ?? task.maxRepairs ?? useMachineDefaults?.maxRepairs ?? profile?.maxRepairs ?? 2));
    if (!Number.isFinite(maxRepairs)) throw new Error("--max-repairs must be a number.");

    const rawSandbox = task.sandbox === true ? {} : (task.sandbox && typeof task.sandbox === "object" ? task.sandbox : {});
    const sandboxEnabled = Boolean(options.sandbox || task.sandbox === true || rawSandbox.enabled === true);
    if (sandboxEnabled && options.resume) throw new Error("Sandbox resume is not supported in v0.7; rerun the task in a fresh disposable sandbox or use host mode with --resume.");

    if (sandboxEnabled && options.apply && String(rawSandbox.network ?? "none") !== "none") {
        approvalManager.require("sandbox_network", { network: rawSandbox.network });
    }

    let sandboxSession = null;
    let workingWorkspace = originalWorkspace;
    let executionProvider = new HostExecutionProvider();
    let sandboxInfo = { enabled: sandboxEnabled, provider: executionProvider.describe(), promoted: false, promotedChanges: [], artifacts: [], visualEvidence: [], computerEvidence: [] };

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

    const rawComputer = task.computer === true ? {} : (task.computer && typeof task.computer === "object" ? task.computer : {});
    const computerEnabled = Boolean(options.computer || task.computer === true || rawComputer.enabled === true);
    const computerConfig = computerEnabled ? {
        ...rawComputer,
        enabled: true,
        driver: options["computer-driver"] ?? rawComputer.driver ?? "cdp",
        endpoint: options["computer-endpoint"] ?? rawComputer.endpoint,
        targetHint: options["computer-target"] ?? rawComputer.targetHint ?? rawComputer.target
    } : null;
    if (sandboxEnabled && options.apply && computerConfig && computerConfig.driver !== "replay") {
        throw new Error("Real computer/IDE control cannot be combined with --sandbox in v0.8 because a host GUI could bypass PASS-only sandbox promotion. Use host mode or the replay driver.");
    }
    const computerSession = computerConfig ? createComputerSession(computerConfig, { workspace: workingWorkspace, taskId }) : null;

    let resumeState = null;
    if (options.resume) {
        resumeState = await loadState(originalWorkspace, taskId);
        if (!resumeState) throw new Error(`No checkpoint exists for task ${taskId}.`);
    }

    console.log(`ForgePilot v${VERSION}`);
    console.log(`Goal: ${task.goal ?? "(no goal supplied)"}`);
    console.log(`Workspace: ${originalWorkspace}`);
    console.log(`Planner: ${plannerName}`);
    if (profile) console.log(`Profile: ${profile.name} (${profile.hardware.memoryGiB} GiB RAM / ${profile.hardware.logicalCpus} CPUs)${useMachineDefaults?.tier ? ` / machine tier ${useMachineDefaults.tier}` : ""}`);
    if (secretStore.summary().length) console.log(`Secrets: ${secretStore.summary().length} environment-backed reference(s)`);
    if (approvalManager.snapshot().required.length) console.log(`Required approvals: ${approvalManager.snapshot().required.join(", ")}`);
    console.log(`Agent team: ${agentsEnabled ? `ON (review rounds ${maxReviewRounds}, verifier gate ${agentTeam.requireVerifierApproval ? "required" : "advisory"})` : "OFF"}`);
    console.log(`Repair budget: ${maxRepairs}`);
    console.log(`Computer control: ${computerSession ? `${computerConfig.driver}${computerConfig.endpoint ? ` @ ${computerConfig.endpoint}` : ""}` : "OFF"}`);
    if (sandboxEnabled) console.log(`Sandbox: ${options.apply ? `${sandboxInfo.provider.runtime ?? "planned"} / ${sandboxInfo.provider.image ?? rawSandbox.image ?? "node:22-bookworm"}` : "planned"}`);
    console.log(`Mode: ${options.apply ? "APPLY" : "PLAN ONLY"}${options.resume ? " / RESUME" : ""}\n`);

    await recovery.begin({ taskPath, workspace: originalWorkspace, goal: task.goal ?? "", profile: profile?.name ?? null });
    let outcome;
    let status = "FAIL";
    try {
        await recovery.checkpoint("execution", { apply: Boolean(options.apply) });
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
            visionProvider,
            agentTeam,
            computerSession,
            approvalManager,
            secretStore
        });

        console.log(`Plan rationale: ${outcome.plan.rationale ?? "(none)"}`);
        console.log(`Actions: ${outcome.plan.actions.length}; verification checks: ${outcome.plan.verify.length}`);
        if (outcome.repairCount > 0) console.log(`Repair attempts used: ${outcome.repairCount}/${maxRepairs}`);
        console.log("");

        const actionFailure = outcome.actions.some((item) => item.status === "failed") && !outcome.verification.passed;
        status = !options.apply ? "PLANNED" : (!actionFailure && outcome.verification.passed ? "PASS" : "FAIL");

        if (computerSession) await computerSession.close();
        const computerInfo = computerSession ? computerSession.snapshot() : { enabled: false };

        if (sandboxSession) {
            const visualArtifacts = Array.isArray(outcome.visual?.evidencePaths) ? outcome.visual.evidencePaths : [];
            sandboxInfo.visualEvidence = await sandboxSession.exportEvidence(visualArtifacts);
            sandboxInfo.computerEvidence = await sandboxSession.exportEvidence(computerInfo.evidencePaths ?? []);
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
            multiAgent: outcome.multiAgent ?? agentTeam.snapshot(),
            computer: computerInfo,
            profile: profile ? { name: profile.name, requested: profile.requested, hardware: useMachineDefaults?.hardware ?? profile.hardware, tier: useMachineDefaults?.tier ?? null, model: effectiveOptions.model ?? profile.model, maxContextTokens: task.maxContextTokens ?? profile.maxContextTokens, maxRepairs, maxReviewRounds } : null,
            security: { secrets: secretStore.summary(), approvals: approvalManager.snapshot() },
            sandbox: sandboxInfo
        };

        await recovery.checkpoint("reporting", { status });
        const safeReport = secretStore.redactObject(report);
        const artifacts = await writeReport(originalWorkspace, safeReport);
        const provenance = await signReport(originalWorkspace, artifacts.jsonPath);
        await recovery.complete(status, { reportPath: artifacts.jsonPath, provenancePath: provenance.provenancePath, keyId: provenance.keyId });
        console.log(`Result: ${status}`);
        if (sandboxEnabled && options.apply) console.log(`Sandbox promotion: ${sandboxInfo.promoted ? `PASS (${sandboxInfo.promotedChanges.length} file change(s))` : "NOT PROMOTED"}`);
        console.log(`Report: ${artifacts.markdownPath}`);
        console.log(`JSON:   ${artifacts.jsonPath}`);
        console.log(`Signed: ${provenance.provenancePath} (key ${provenance.keyId})`);

        if (status === "FAIL") process.exitCode = 2;
    } catch (error) {
        await recovery.fail(error).catch(() => {});
        throw error;
    } finally {
        if (computerSession) await computerSession.close();
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

async function preflightCommand(workspaceArg, options = {}) {
    const workspace = await ensureWorkspace(workspaceArg ?? ".");
    const goal = String(options.goal ?? "").trim();
    if (!goal) throw new Error("preflight requires --goal TEXT.");
    const result = await buildPreflight(workspace, { goal, maxContextTokens: Number(options["max-context-tokens"] ?? 4000) });
    console.log(`ForgePilot v${VERSION} change preflight`);
    console.log(`Workspace: ${result.workspace}`);
    console.log(`Risk: ${result.risk.level.toUpperCase()} (${result.risk.points})`);
    for (const reason of result.risk.reasons) console.log(`  - ${reason}`);
    console.log(`Likely context/touch points: ${result.likelyTouched.join(", ") || "(none)"}`);
    console.log(`Existing dirty paths: ${result.dirty.entries.length}`);
    console.log("Checkpoint: required before dashboard execution");
}

async function rollbackCommand(workspaceArg, checkpointId, options = {}) {
    if (!workspaceArg || !checkpointId) throw new Error("rollback requires <workspace> <checkpoint-id>.");
    const workspace = await ensureWorkspace(workspaceArg);
    const result = await rollbackWorkspaceCheckpoint(workspace, checkpointId, { dryRun: Boolean(options["dry-run"]) });
    console.log(`ForgePilot v${VERSION} rollback`);
    console.log(`Checkpoint: ${checkpointId}`);
    console.log(`Mode: ${result.dryRun ? "DRY RUN" : "APPLY"}`);
    console.log(`Restorable files: ${result.restored.length}`);
    if (result.conflicts.length) {
        console.log("Conflicts:");
        for (const item of result.conflicts) console.log(`  - ${item.path}`);
    }
    console.log(`Result: ${result.passed ? "PASS" : "BLOCKED"}`);
    if (!result.passed) process.exitCode = 2;
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

async function setupCommand(options = {}) {
    const hardware = await inspectSystem();
    const plan = recommendMachinePlan(hardware);
    const config = { version: VERSION, configuredAt: new Date().toISOString(), ...plan };
    const configPath = await saveMachineConfig(config);
    const envPath = path.join(path.dirname(configPath), "launcher-env.cmd");
    await writeLauncherEnvironment(config, envPath);
    if (options.json) {
        console.log(JSON.stringify({ configPath, envPath, ...config }, null, 2));
        return;
    }
    console.log(`ForgePilot v${VERSION} automatic setup`);
    console.log(`Machine tier: ${config.tier}`);
    console.log(`RAM: ${hardware.memoryGiB} GiB total / ${hardware.availableMemoryGiB} GiB currently available`);
    console.log(`CPU: ${hardware.logicalCpus} logical CPUs${hardware.cpuModels?.[0] ? ` / ${hardware.cpuModels[0]}` : ""}`);
    if (hardware.gpus?.length) console.log(`GPU: ${hardware.gpus.map((g) => `${g.name}${g.vramGiB ? ` (${g.vramGiB} GiB)` : ""}`).join(", ")}`);
    if (hardware.disk?.freeGiB != null) console.log(`Free disk: ${hardware.disk.freeGiB} GiB`);
    console.log(`Profile: ${config.profile}`);
    console.log(`Coding model: ${config.model}`);
    console.log(`Bootstrap model: ${config.bootstrapModel}`);
    console.log(`Vision model: ${config.visionModel ?? "disabled to conserve memory"}`);
    console.log(`Context: ${config.maxContextTokens}; repairs: ${config.maxRepairs}; review rounds: ${config.maxReviewRounds}; agent team: ${config.agentTeamEnabled ? "ON" : "OFF"}`);
    console.log(`Config: ${configPath}`);
    for (const note of config.notes ?? []) console.log(`NOTE: ${note}`);
}

async function launchCommand(workspaceArg, options = {}) {
    const port = Number(options.port ?? 3210);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 to 65535.");
    const launched = await launchForgePilot({ workspace: workspaceArg, port, openBrowser: !options["no-browser"] });
    console.log(`ForgePilot v${VERSION} launcher`);
    console.log(`Workspace: ${launched.workspace}`);
    if (launched.machineConfig) console.log(`Machine tier: ${launched.machineConfig.tier}; model: ${launched.machineConfig.model}`);
    console.log(`Open: ${launched.url}`);
    console.log("Leave this window open while using ForgePilot. Press Ctrl+C to stop it.");
}

async function profileCommand(name = "auto") {
    if (name === "auto") {
        const hardware = await inspectSystem();
        const plan = recommendMachinePlan(hardware);
        console.log(`ForgePilot v${VERSION} profile`);
        console.log(`Selected: ${plan.profile} (auto / ${plan.tier})`);
        console.log(`Hardware: ${hardware.memoryGiB} GiB RAM (${hardware.availableMemoryGiB} GiB available), ${hardware.logicalCpus} logical CPUs, ${hardware.platform}/${hardware.arch}`);
        console.log(`Coding model: ${plan.model}`);
        console.log(`Vision model: ${plan.visionModel ?? "disabled"}`);
        console.log(`Context: ${plan.maxContextTokens}; repairs: ${plan.maxRepairs}; review rounds: ${plan.maxReviewRounds}; agent team: ${plan.agentTeamEnabled ? "ON" : "OFF"}`);
        return;
    }
    const profile = resolveProfile(name);
    console.log(`ForgePilot v${VERSION} profile`);
    console.log(`Selected: ${profile.name}`);
    console.log(`Recommended: ${profile.recommended}`);
    console.log(`Hardware: ${profile.hardware.memoryGiB} GiB RAM, ${profile.hardware.logicalCpus} logical CPUs, ${profile.hardware.platform}/${profile.hardware.arch}`);
    console.log(`Coding model: ${profile.model}`);
    console.log(`Vision model: ${profile.visionModel}`);
    console.log(`Context: ${profile.maxContextTokens}; repairs: ${profile.maxRepairs}; review rounds: ${profile.maxReviewRounds}`);
}

async function recoverCommand(workspaceArg = ".") {
    const workspace = await ensureWorkspace(workspaceArg);
    const journals = await listRecoveryJournals(workspace);
    console.log(`ForgePilot v${VERSION} recovery journal`);
    if (!journals.length) return console.log("No recovery journals found.");
    for (const item of journals) console.log(`${item.taskId}  ${item.status}${item.stale ? " (interrupted)" : ""}  ${item.phase ?? ""}  ${item.updatedAt ?? ""}`);
    if (journals.some((item) => item.stale || ["failed", "crashed"].includes(item.status))) console.log("Use the original task with `forgepilot run <task.json> --resume --apply` when a checkpoint is available.");
}

async function verifyRunCommand(reportArg, options) {
    if (!reportArg) throw new Error("verify-run requires <report.json>.");
    const result = await verifyReportProvenance(path.resolve(reportArg), { trustedPublicKeyPath: options["public-key"] ?? null });
    console.log(`ForgePilot v${VERSION} provenance verification`);
    console.log(`Signature: ${result.signatureValid ? "PASS" : "FAIL"}`);
    console.log(`SHA-256:   ${result.hashValid ? "PASS" : "FAIL"}`);
    if (result.trustedKeyMatch !== null) console.log(`Trusted key: ${result.trustedKeyMatch ? "PASS" : "FAIL"}`);
    console.log(`Key ID: ${result.keyId}`);
    console.log(`Result: ${result.passed ? "PASS" : "FAIL"}`);
    if (!result.passed) process.exitCode = 2;
}

async function dashboardCommand(workspaceArg, options) {
    const workspace = await ensureWorkspace(workspaceArg ?? ".");
    const port = Number(options.port ?? 3210);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 to 65535.");
    const machineConfig = await loadMachineConfig().catch(() => null);
    const dashboard = await createDashboardServer({ workspace, port, launcher: { machineConfig } });
    console.log(`ForgePilot v${VERSION} dashboard`);
    console.log(`Workspace: ${workspace}`);
    console.log(`Open: http://${dashboard.host}:${dashboard.port}/`);
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || ["help", "--help", "-h"].includes(command)) return usage();
    if (["version", "--version", "-v"].includes(command)) return console.log(VERSION);
    if (command === "doctor") return doctor();
    if (command === "setup") { const { options } = parseOptions(rest); return setupCommand(options); }
    if (command === "launch") { const { options, positionals } = parseOptions(rest); return launchCommand(positionals[0], options); }
    if (command === "profile") return profileCommand(rest[0] ?? "auto");
    if (command === "recover") return recoverCommand(rest[0] ?? ".");

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

    if (command === "preflight") {
        const { options, positionals } = parseOptions(rest);
        return preflightCommand(positionals[0] ?? ".", options);
    }

    if (command === "rollback") {
        const { options, positionals } = parseOptions(rest);
        return rollbackCommand(positionals[0], positionals[1], options);
    }

    if (command === "compare-images") {
        const { options, positionals } = parseOptions(rest);
        return compareImagesCommand(positionals[0], positionals[1], options);
    }

    if (command === "verify-run") {
        const { options, positionals } = parseOptions(rest);
        return verifyRunCommand(positionals[0], options);
    }

    if (command === "dashboard") {
        const { options, positionals } = parseOptions(rest);
        return dashboardCommand(positionals[0] ?? ".", options);
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
