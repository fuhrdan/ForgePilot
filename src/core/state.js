import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "./paths.js";

export function createTaskId(taskFile, task) {
    const source = `${path.resolve(taskFile)}\n${task.goal ?? ""}`;
    return crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
}

export function statePath(workspace, taskId) {
    return resolveInside(workspace, `.forgepilot/state/${taskId}.json`);
}

export async function saveState(workspace, state) {
    const target = statePath(workspace, state.taskId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const next = { ...state, updatedAt: new Date().toISOString() };
    await fs.writeFile(target, JSON.stringify(next, null, 2) + "\n", "utf8");
    return next;
}

export async function loadState(workspace, taskId) {
    const target = statePath(workspace, taskId);
    try {
        return JSON.parse(await fs.readFile(target, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}
