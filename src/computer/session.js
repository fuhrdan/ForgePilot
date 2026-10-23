import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resolveInside } from "../core/paths.js";
import { validateComputerAction, traceSafeAction } from "./policy.js";

function safePart(value) { return String(value ?? "computer").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80); }

export class ComputerSession {
    constructor({ driver, workspace, taskId = "task", policy = {}, persistTrace = true } = {}) {
        if (!driver) throw new Error("ComputerSession requires a driver.");
        this.driver = driver;
        this.workspace = path.resolve(workspace);
        this.taskId = safePart(taskId);
        this.policy = policy;
        this.persistTrace = persistTrace;
        this.started = false;
        this.sequence = 0;
        this.trace = [];
        this.evidenceDir = path.join(this.workspace, ".forgepilot", "computer", this.taskId);
        this.tracePath = path.join(this.evidenceDir, "trace.json");
    }

    async start() {
        if (this.started) return;
        await fs.mkdir(this.evidenceDir, { recursive: true });
        const target = await this.driver.start();
        this.started = true;
        this.trace.push({ sequence: 0, at: new Date().toISOString(), event: "session_start", driver: this.driver.describe?.() ?? {}, target });
        await this.#flush();
    }

    async execute(action) {
        validateComputerAction(action, this.workspace, this.policy);
        await this.start();
        let targetUrl = null;
        if (!["computer_navigate", "computer_wait"].includes(action.type) && typeof this.driver.currentUrl === "function") {
            const currentUrl = await this.driver.currentUrl();
            targetUrl = currentUrl;
            const readOnly = ["computer_inspect", "computer_assert", "computer_screenshot"].includes(action.type);
            if (currentUrl === "about:blank" && readOnly) {
                // Safe empty target for inspection/evidence.
            } else {
                validateComputerAction({ type: "computer_navigate", url: currentUrl }, this.workspace, this.policy);
            }
        }
        const sequence = ++this.sequence;
        let prepared = { ...action };
        if (action.type === "computer_screenshot") {
            const requested = action.path ?? `step-${String(sequence).padStart(3, "0")}.png`;
            const outputPath = resolveInside(this.evidenceDir, requested);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            prepared = { ...action, outputPath };
        }
        const startedAt = Date.now();
        const record = { sequence, at: new Date().toISOString(), action: traceSafeAction(action), status: "running", ...(targetUrl ? { targetUrl } : {}) };
        this.trace.push(record);
        try {
            const result = await this.driver.perform(prepared);
            record.status = "passed";
            record.durationMs = Date.now() - startedAt;
            record.result = this.#safeResult(action, result);
            if (action.type === "computer_screenshot" && result?.outputPath) {
                const relative = path.relative(this.workspace, result.outputPath).split(path.sep).join("/");
                record.evidence = relative;
            }
            await this.#flush();
            return { status: "passed", sequence, ...record.result, ...(record.evidence ? { evidence: record.evidence } : {}) };
        } catch (error) {
            record.status = "failed";
            record.durationMs = Date.now() - startedAt;
            record.error = error.message;
            await this.#flush();
            return { status: "failed", sequence, error: error.message };
        }
    }

    #safeResult(action, result) {
        if (!result || typeof result !== "object") return result;
        const copy = { ...result };
        if (action.type === "computer_type") {
            delete copy.text;
            copy.typedChars = Number(copy.typedChars ?? String(action.text ?? "").length);
        }
        if (action.type === "computer_inspect" && Array.isArray(copy.nodes)) {
            copy.nodeCount = copy.nodes.length;
        }
        delete copy.outputPath;
        return copy;
    }

    async #flush() {
        if (!this.persistTrace) return;
        await fs.mkdir(this.evidenceDir, { recursive: true });
        await fs.writeFile(this.tracePath, JSON.stringify({ version: 1, taskId: this.taskId, driver: this.driver.describe?.() ?? {}, trace: this.trace }, null, 2) + "\n", "utf8");
    }

    snapshot() {
        return {
            enabled: true,
            driver: this.driver.describe?.() ?? {},
            actions: this.trace.filter((item) => item.action).length,
            passed: this.trace.filter((item) => item.action && item.status === "passed").length,
            failed: this.trace.filter((item) => item.action && item.status === "failed").length,
            tracePath: path.relative(this.workspace, this.tracePath).split(path.sep).join("/"),
            evidenceDir: path.relative(this.workspace, this.evidenceDir).split(path.sep).join("/"),
            evidencePaths: [
                path.relative(this.workspace, this.tracePath).split(path.sep).join("/"),
                ...this.trace.filter((item) => item.evidence).map((item) => item.evidence)
            ]
        };
    }

    async close() {
        if (!this.started) return;
        this.trace.push({ sequence: ++this.sequence, at: new Date().toISOString(), event: "session_stop" });
        await this.#flush();
        await this.driver.stop?.();
        this.started = false;
    }
}

export function hashText(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}
