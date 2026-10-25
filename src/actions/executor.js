import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";
import { runCommand } from "../core/command.js";
import { ForgePilotError } from "../core/errors.js";
import { COMPUTER_ACTION_TYPES } from "../computer/policy.js";

function approvalFailure(index, action, error) {
    return { index, type: action.type, status: "failed", error: error.message, code: error.code ?? "APPROVAL_REQUIRED" };
}

export async function executeAction(action, workspace, {
    apply = false,
    index = 0,
    executionProvider = null,
    computerSession = null,
    approvalManager = null,
    secretStore = null
} = {}) {
    if (!apply) return { index, type: action.type, status: "planned", action };

    try { approvalManager?.checkAction(action, { secretStore }); }
    catch (error) { return approvalFailure(index, action, error); }

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

    if (COMPUTER_ACTION_TYPES.has(action.type)) {
        if (!computerSession) {
            return { index, type: action.type, status: "failed", error: "Computer action requested but no computer session is enabled." };
        }
        let prepared = { ...action };
        try {
            if (action.type === "computer_type" && secretStore) {
                if (action.secretRef) prepared = { ...prepared, text: secretStore.get(action.secretRef), secret: true };
                else if (secretStore.containsReference(action.text)) prepared = { ...prepared, text: secretStore.resolveValue(action.text), secret: true };
            }
        } catch (error) {
            return { index, type: action.type, status: "failed", error: error.message, code: error.code ?? "SECRET_ERROR" };
        }
        const result = await computerSession.execute(prepared);
        return { index, type: action.type, ...result };
    }

    if (action.type === "run_command") {
        const cwd = resolveInside(workspace, action.cwd ?? ".");
        const runner = executionProvider?.run ? executionProvider.run.bind(executionProvider) : runCommand;
        let args;
        let env;
        try {
            args = Array.isArray(action.args) ? action.args.map((value) => String(secretStore ? secretStore.resolveValue(value) : value)) : [];
            env = secretStore ? secretStore.resolveEnv(action.env ?? {}) : Object.fromEntries(Object.entries(action.env ?? {}).map(([key, value]) => [key, String(value)]));
        } catch (error) {
            return { index, type: action.type, status: "failed", error: error.message, code: error.code ?? "SECRET_ERROR" };
        }
        const result = await runner({
            command: action.command,
            args,
            env,
            cwd,
            timeoutMs: Number(action.timeoutMs ?? 300000)
        });
        const safeResult = secretStore ? secretStore.redactObject(result) : result;
        const expected = Number(action.expectExitCode ?? 0);
        const passed = result.exitCode === expected && !result.timedOut;
        return { index, type: action.type, status: passed ? "passed" : "failed", expectedExitCode: expected, ...safeResult };
    }

    throw new ForgePilotError(`Unsupported action type: ${action.type}`, "UNSUPPORTED_ACTION");
}

export async function executePlan(plan, workspace, options = {}) {
    const results = [];
    for (let index = 0; index < plan.actions.length; index++) {
        const result = await executeAction(plan.actions[index], workspace, { ...options, index });
        results.push(result);
        if (result.status === "failed") break;
    }
    return results;
}
