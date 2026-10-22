import crypto from "node:crypto";
import fs from "node:fs/promises";
import { executeAction } from "../actions/executor.js";
import { resolveInside } from "../core/paths.js";
import { runCommand } from "../core/command.js";
import { summarizeGitDiff } from "../repository/git-diff.js";
import { testPathAllowed } from "./discovery.js";

function commandSpec(value) {
    if (!value) return null;
    return {
        command: value.command,
        args: Array.isArray(value.args) ? value.args.map(String) : [],
        cwd: value.cwd ?? ".",
        timeoutMs: Number(value.timeoutMs ?? 120000),
        stdoutIncludes: value.stdoutIncludes,
        stderrIncludes: value.stderrIncludes,
        failureIncludes: value.failureIncludes
    };
}

export function normalizeTestFirst(plan, repository, task = {}) {
    const raw = plan.testFirst ?? task.testFirst;
    if (!raw) return null;
    const settings = raw === true ? {} : raw;
    const discovered = repository?.testing ?? {};
    const red = commandSpec(settings.red ?? settings.testCommand ?? discovered.targetedTestCommand ?? discovered.primaryTestCommand);
    const green = commandSpec(settings.green ?? settings.testCommand ?? discovered.targetedTestCommand ?? discovered.primaryTestCommand);
    const regression = commandSpec(settings.regression ?? discovered.regressionCommand);
    const builds = Array.isArray(settings.build)
        ? settings.build.map(commandSpec).filter(Boolean)
        : settings.build ? [commandSpec(settings.build)] : (discovered.buildCommands ?? []).map(commandSpec).filter(Boolean);
    return {
        testActions: Array.isArray(settings.testActions) ? settings.testActions : [],
        allowedTestPaths: Array.isArray(settings.allowedTestPaths) ? settings.allowedTestPaths : [],
        requireTestChange: settings.requireTestChange !== false,
        red,
        green,
        regression,
        builds,
        selectedTests: discovered.selectedTests ?? []
    };
}

export async function executeTestAuthoring(testFirst, workspace, { apply = true, executionProvider = null } = {}) {
    const results = [];
    for (let index = 0; index < testFirst.testActions.length; index++) {
        const action = testFirst.testActions[index];
        if (["write_file", "replace_text"].includes(action.type) && !testPathAllowed(action.path, testFirst.allowedTestPaths)) {
            results.push({ index, type: action.type, status: "failed", path: action.path, error: "Test-first authoring phase may modify only recognized/allowed test paths." });
            break;
        }
        if (!['write_file', 'replace_text'].includes(action.type)) {
            results.push({ index, type: action.type, status: "failed", error: "Test-first authoring phase accepts only write_file or replace_text actions." });
            break;
        }
        const result = await executeAction(action, workspace, { apply, index, executionProvider });
        results.push(result);
        if (result.status === "failed") break;
    }
    return results;
}

export async function verifyTestOnlyDiff(workspace, gitBaseline, testFirst) {
    const allowed = [
        ...testFirst.allowedTestPaths,
        ...testFirst.testActions.filter((action) => ["write_file", "replace_text"].includes(action.type)).map((action) => action.path)
    ];
    const diff = await summarizeGitDiff(workspace, gitBaseline, allowed);
    if (!gitBaseline?.isRepository) {
        const changedTestActions = testFirst.testActions.filter((action) => ["write_file", "replace_text"].includes(action.type));
        return {
            passed: !testFirst.requireTestChange || changedTestActions.length > 0,
            available: false,
            changedFiles: changedTestActions.map((action) => ({ path: action.path, status: "planned-change" })),
            unexpectedFiles: []
        };
    }
    const hasChange = diff.changedFiles.length > 0;
    return {
        ...diff,
        passed: !diff.incomplete && diff.unexpectedFiles.length === 0 && (!testFirst.requireTestChange || hasChange)
    };
}

export async function runRedGate(workspace, gate, executionProvider = null) {
    if (!gate?.command) {
        return { phase: "red", status: "failed", validRed: false, reason: "No executable test command could be discovered or supplied." };
    }
    let result;
    try {
        const runner = executionProvider?.run ? executionProvider.run.bind(executionProvider) : runCommand;
        result = await runner({ command: gate.command, args: gate.args, cwd: resolveInside(workspace, gate.cwd ?? "."), timeoutMs: gate.timeoutMs });
    } catch (error) {
        return { phase: "red", status: "failed", validRed: false, reason: `Test infrastructure failed; ${error.message}`, command: gate.command, args: gate.args, exitCode: -1, stdout: "", stderr: error.message, timedOut: false };
    }
    const infrastructureFailure = result.exitCode === -1 || result.timedOut;
    const combined = `${result.stdout}
${result.stderr}`;
    const signatureMatched =
        (gate.stdoutIncludes === undefined || result.stdout.includes(String(gate.stdoutIncludes))) &&
        (gate.stderrIncludes === undefined || result.stderr.includes(String(gate.stderrIncludes))) &&
        (gate.failureIncludes === undefined || combined.includes(String(gate.failureIncludes)));
    const validRed = !infrastructureFailure && result.exitCode !== 0 && signatureMatched;
    let reason;
    if (infrastructureFailure) reason = "Test infrastructure failed; this does not count as RED.";
    else if (result.exitCode === 0) reason = "Test was already green; implementation is blocked to prevent a false test-first claim.";
    else if (!signatureMatched) reason = "Test failed, but not for the expected reason; RED evidence signature did not match.";
    else reason = gate.failureIncludes !== undefined || gate.stdoutIncludes !== undefined || gate.stderrIncludes !== undefined
        ? "New/targeted test failed for the expected reason before implementation."
        : "New/targeted test failed before implementation (no failure signature was required).";
    return {
        phase: "red",
        status: validRed ? "passed" : "failed",
        validRed,
        signatureMatched,
        reason,
        expectedFailure: { stdoutIncludes: gate.stdoutIncludes, stderrIncludes: gate.stderrIncludes, failureIncludes: gate.failureIncludes },
        ...result
    };
}

export function gateToVerificationCheck(gate, phase, index) {
    return {
        index,
        type: "test_gate",
        phase,
        command: gate.command,
        args: gate.args,
        cwd: gate.cwd ?? ".",
        timeoutMs: gate.timeoutMs ?? 120000,
        expectExitCode: 0
    };
}

export function appendEngineeringGates(plan, testFirst) {
    const verify = [...(plan.verify ?? [])];
    const existingPhases = new Set(verify.filter((check) => check.type === "test_gate").map((check) => check.phase));
    let index = verify.length;
    if (testFirst.green && !existingPhases.has("green")) verify.push(gateToVerificationCheck(testFirst.green, "green", index++));
    if (testFirst.regression && !existingPhases.has("regression") && JSON.stringify(testFirst.regression) !== JSON.stringify(testFirst.green)) {
        verify.push(gateToVerificationCheck(testFirst.regression, "regression", index++));
    }
    if (!existingPhases.has("build")) for (const build of testFirst.builds) verify.push(gateToVerificationCheck(build, "build", index++));
    return { ...plan, verify };
}

export function protectedTestPaths(testFirst) {
    return [...new Set(testFirst.testActions
        .filter((action) => ["write_file", "replace_text"].includes(action.type) && action.path)
        .map((action) => String(action.path).replaceAll("\\", "/")))];
}

export function actionTouchesProtectedTest(action, protectedPaths = []) {
    if (!["write_file", "replace_text"].includes(action?.type) || !action.path) return false;
    const normalized = String(action.path).replaceAll("\\", "/");
    return protectedPaths.includes(normalized);
}

export async function captureProtectedTestSnapshot(workspace, paths) {
    const files = {};
    for (const relative of paths) {
        try {
            const data = await fs.readFile(resolveInside(workspace, relative));
            files[relative] = crypto.createHash("sha256").update(data).digest("hex");
        } catch {
            files[relative] = null;
        }
    }
    return { files };
}

export async function verifyProtectedTestSnapshot(workspace, snapshot) {
    const changed = [];
    for (const [relative, before] of Object.entries(snapshot?.files ?? {})) {
        let after = null;
        try {
            const data = await fs.readFile(resolveInside(workspace, relative));
            after = crypto.createHash("sha256").update(data).digest("hex");
        } catch { /* missing remains null */ }
        if (after !== before) changed.push(relative);
    }
    return { passed: changed.length === 0, changed };
}
