import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";
import { runCommand } from "../core/command.js";
import { ForgePilotError } from "../core/errors.js";

export async function executeAction(action, workspace, { apply = false, index = 0 } = {}) {
    if (!apply) return { index, type: action.type, status: "planned", action };

    if (action.type === "write_file") {
        const target = resolveInside(workspace, action.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, String(action.content ?? ""), "utf8");
        return { index, type: action.type, status: "passed", path: action.path };
    }

    if (action.type === "replace_text") {
        const target = resolveInside(workspace, action.path);
        const find = String(action.find ?? "");
        const replacement = String(action.replace ?? "");
        if (!find) throw new ForgePilotError("replace_text requires a non-empty find value.", "INVALID_PATCH");

        const content = await fs.readFile(target, "utf8");
        const occurrences = content.split(find).length - 1;
        const expected = Number(action.expectedOccurrences ?? 1);
        if (occurrences !== expected) {
            return {
                index,
                type: action.type,
                status: "failed",
                path: action.path,
                error: `Expected ${expected} occurrence(s) but found ${occurrences}.`
            };
        }

        const updated = content.split(find).join(replacement);
        await fs.writeFile(target, updated, "utf8");
        return { index, type: action.type, status: "passed", path: action.path, occurrences };
    }

    if (action.type === "run_command") {
        const cwd = resolveInside(workspace, action.cwd ?? ".");
        const result = await runCommand({
            command: action.command,
            args: Array.isArray(action.args) ? action.args.map(String) : [],
            cwd,
            timeoutMs: Number(action.timeoutMs ?? 120000)
        });
        const expected = Number(action.expectExitCode ?? 0);
        const passed = result.exitCode === expected && !result.timedOut;
        return { index, type: action.type, status: passed ? "passed" : "failed", expectedExitCode: expected, ...result };
    }

    throw new ForgePilotError(`Unsupported action type: ${action.type}`, "UNSUPPORTED_ACTION");
}

export async function executePlan(plan, workspace, { apply = false } = {}) {
    const results = [];
    for (let index = 0; index < plan.actions.length; index++) {
        const result = await executeAction(plan.actions[index], workspace, { apply, index });
        results.push(result);
        if (result.status === "failed") break;
    }
    return results;
}
