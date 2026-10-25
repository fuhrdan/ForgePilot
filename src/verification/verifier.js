import fs from "node:fs/promises";
import { resolveInside } from "../core/paths.js";
import { runCommand } from "../core/command.js";
import { getGitStatus } from "../core/workspace.js";
import { summarizeGitDiff } from "../repository/git-diff.js";

async function exists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

function expectedPathsFromPlan(plan, extras = []) {
    const paths = [...extras];
    for (const action of plan.actions ?? []) {
        if (["write_file", "replace_text"].includes(action.type) && action.path) paths.push(action.path);
    }
    for (const action of plan.testFirst?.testActions ?? []) {
        if (["write_file", "replace_text"].includes(action.type) && action.path) paths.push(action.path);
    }
    return [...new Set(paths.map(String))];
}

export async function verifyPlan(plan, workspace, {
    apply = false,
    gitBaseline = null,
    expectedChangePaths = [],
    enforceGitScope = false,
    executionProvider = null,
    approvalManager = null,
    secretStore = null
} = {}) {
    const expectedPaths = expectedPathsFromPlan(plan, expectedChangePaths);
    const git = await getGitStatus(workspace);

    if (!apply) {
        return {
            passed: null,
            checks: plan.verify.map((check, index) => ({ index, type: check.type, status: "planned" })),
            git,
            gitDiff: await summarizeGitDiff(workspace, gitBaseline, expectedPaths)
        };
    }

    const checks = [];

    for (let index = 0; index < plan.verify.length; index++) {
        const check = plan.verify[index];

        if (check.type === "file_exists") {
            const found = await exists(resolveInside(workspace, check.path));
            checks.push({ index, type: check.type, status: found ? "passed" : "failed", path: check.path });
            continue;
        }

        if (check.type === "file_contains") {
            const target = resolveInside(workspace, check.path);
            let content = "";
            try { content = await fs.readFile(target, "utf8"); } catch { /* verifier records failure below */ }
            const found = content.includes(String(check.text ?? ""));
            checks.push({ index, type: check.type, status: found ? "passed" : "failed", path: check.path, text: check.text });
            continue;
        }

        if (check.type === "command" || check.type === "test_gate") {
            const cwd = resolveInside(workspace, check.cwd ?? ".");
            try { approvalManager?.require("command_exec", { phase: check.phase ?? "verification", command: check.command }); }
            catch (error) { checks.push({ index, type: check.type, phase: check.phase, status: "failed", error: error.message, code: error.code ?? "APPROVAL_REQUIRED" }); continue; }
            const runner = executionProvider?.run ? executionProvider.run.bind(executionProvider) : runCommand;
            let args;
            let env;
            try {
                args = Array.isArray(check.args) ? check.args.map((value) => String(secretStore ? secretStore.resolveValue(value) : value)) : [];
                env = secretStore ? secretStore.resolveEnv(check.env ?? {}) : Object.fromEntries(Object.entries(check.env ?? {}).map(([key, value]) => [key, String(value)]));
                if (secretStore && (secretStore.containsReference(check.args) || secretStore.containsReference(check.env))) approvalManager?.require("secret_use", { phase: check.phase ?? "verification" });
            } catch (error) { checks.push({ index, type: check.type, phase: check.phase, status: "failed", error: error.message, code: error.code ?? "SECRET_ERROR" }); continue; }
            const resultRaw = await runner({
                command: check.command,
                args,
                env,
                cwd,
                timeoutMs: Number(check.timeoutMs ?? 300000)
            });
            const result = secretStore ? secretStore.redactObject(resultRaw) : resultRaw;
            const expectedExit = Number(check.expectExitCode ?? 0);
            const exitOkay = resultRaw.exitCode === expectedExit && !resultRaw.timedOut;
            const stdoutOkay = check.stdoutIncludes === undefined || result.stdout.includes(String(check.stdoutIncludes));
            const stderrOkay = check.stderrIncludes === undefined || result.stderr.includes(String(check.stderrIncludes));
            checks.push({
                index,
                type: check.type,
                phase: check.phase,
                status: exitOkay && stdoutOkay && stderrOkay ? "passed" : "failed",
                ...result,
                expectedExit,
                stdoutIncludes: check.stdoutIncludes,
                stderrIncludes: check.stderrIncludes
            });
            continue;
        }

        if (check.type === "git_diff") {
            const allowed = Array.isArray(check.allowedPaths) ? check.allowedPaths : expectedPaths;
            const diff = await summarizeGitDiff(workspace, gitBaseline, allowed);
            const maxChanged = check.maxChangedFiles === undefined ? Infinity : Number(check.maxChangedFiles);
            const noUnexpected = diff.available && !diff.incomplete && diff.unexpectedFiles.length === 0;
            const withinLimit = diff.changedFiles.length <= maxChanged;
            checks.push({
                index,
                type: check.type,
                status: noUnexpected && withinLimit ? "passed" : "failed",
                allowedPaths: allowed,
                maxChangedFiles: Number.isFinite(maxChanged) ? maxChanged : null,
                ...diff
            });
            continue;
        }

        checks.push({ index, type: check.type, status: "failed", error: `Unsupported verification type: ${check.type}` });
    }

    const gitDiff = await summarizeGitDiff(workspace, gitBaseline, expectedPaths);
    if (enforceGitScope && gitDiff.available) {
        checks.push({
            index: checks.length,
            type: "git_scope",
            status: !gitDiff.incomplete && gitDiff.unexpectedFiles.length === 0 ? "passed" : "failed",
            expectedPaths,
            ...gitDiff
        });
    }

    return {
        passed: checks.every((check) => check.status === "passed"),
        checks,
        git,
        gitDiff
    };
}
