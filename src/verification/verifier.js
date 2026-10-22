import fs from "node:fs/promises";
import { resolveInside } from "../core/paths.js";
import { runCommand } from "../core/command.js";
import { getGitStatus } from "../core/workspace.js";

async function exists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

export async function verifyPlan(plan, workspace, { apply = false } = {}) {
    if (!apply) {
        return {
            passed: null,
            checks: plan.verify.map((check, index) => ({ index, type: check.type, status: "planned" })),
            git: await getGitStatus(workspace)
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

        if (check.type === "command") {
            const cwd = resolveInside(workspace, check.cwd ?? ".");
            const result = await runCommand({
                command: check.command,
                args: Array.isArray(check.args) ? check.args.map(String) : [],
                cwd,
                timeoutMs: Number(check.timeoutMs ?? 120000)
            });
            const expectedExit = Number(check.expectExitCode ?? 0);
            const exitOkay = result.exitCode === expectedExit && !result.timedOut;
            const stdoutOkay = check.stdoutIncludes === undefined || result.stdout.includes(String(check.stdoutIncludes));
            const stderrOkay = check.stderrIncludes === undefined || result.stderr.includes(String(check.stderrIncludes));
            checks.push({
                index,
                type: check.type,
                status: exitOkay && stdoutOkay && stderrOkay ? "passed" : "failed",
                ...result,
                expectedExit,
                stdoutIncludes: check.stdoutIncludes,
                stderrIncludes: check.stderrIncludes
            });
            continue;
        }

        checks.push({ index, type: check.type, status: "failed", error: `Unsupported verification type: ${check.type}` });
    }

    const git = await getGitStatus(workspace);
    return {
        passed: checks.every((check) => check.status === "passed"),
        checks,
        git
    };
}
