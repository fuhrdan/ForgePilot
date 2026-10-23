import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";

function recoveryPath(workspace, taskId) {
    return resolveInside(workspace, `.forgepilot/recovery/${taskId}.json`);
}

function processAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; }
    catch { return false; }
}

export class RecoveryJournal {
    constructor(workspace, taskId) {
        this.workspace = workspace;
        this.taskId = taskId;
        this.path = recoveryPath(workspace, taskId);
        this.record = null;
    }

    async begin(metadata = {}) {
        let previous = null;
        try { previous = JSON.parse(await fs.readFile(this.path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
        const interrupted = previous?.status === "running" && !processAlive(previous.pid);
        this.record = {
            version: 1,
            taskId: this.taskId,
            status: "running",
            pid: process.pid,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            interruptedPreviousRun: Boolean(interrupted),
            ...metadata
        };
        await this.#write();
        return this.record;
    }

    async checkpoint(phase, detail = {}) {
        if (!this.record) return null;
        this.record.phase = phase;
        this.record.detail = detail;
        this.record.updatedAt = new Date().toISOString();
        await this.#write();
        return this.record;
    }

    async complete(status, detail = {}) {
        if (!this.record) return null;
        this.record.status = String(status).toLowerCase();
        this.record.phase = "complete";
        this.record.detail = detail;
        this.record.completedAt = new Date().toISOString();
        this.record.updatedAt = this.record.completedAt;
        await this.#write();
        return this.record;
    }

    async fail(error) {
        if (!this.record) return null;
        this.record.status = "crashed";
        this.record.phase = "exception";
        this.record.error = String(error?.message ?? error);
        this.record.updatedAt = new Date().toISOString();
        await this.#write();
        return this.record;
    }

    async #write() {
        await fs.mkdir(path.dirname(this.path), { recursive: true });
        await fs.writeFile(this.path, JSON.stringify(this.record, null, 2) + "\n", "utf8");
    }
}

export async function listRecoveryJournals(workspace) {
    const directory = resolveInside(workspace, ".forgepilot/recovery");
    let names;
    try { names = await fs.readdir(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const records = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
        try {
            const record = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
            records.push({ ...record, stale: record.status === "running" && !processAlive(record.pid) });
        } catch { /* skip malformed recovery record */ }
    }
    return records.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}
