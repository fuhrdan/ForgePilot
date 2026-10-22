import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";
import { runCommand } from "../core/command.js";
import { ForgePilotError } from "../core/errors.js";

export async function executePlan(plan, workspace, { apply = false } = {}) {
    const results = [];

    for (let index = 0; index < plan.actions.length; index++) {
        const action = plan.actions[index];

        if (!apply) {
            results.push({ index, type: action.type, status: "planned", action });
            continue;
        }

        if (action.type === "write_file") {
            const target = resolveInside(workspace, action.path);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, String(action.content ?? ""), "utf8");
            results.push({ index, type: action.type, status: "passed", path: action.path });
            continue;
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
            results.push({ index, type: action.type, status: passed ? "passed" : "failed", ...result });
            if (!passed) break;
            continue;
        }

        throw new ForgePilotError(`Unsupported action type: ${action.type}`, "UNSUPPORTED_ACTION");
    }

    return results;
}
