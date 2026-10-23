import fs from "node:fs/promises";

export class ReplayComputerDriver {
    constructor({ responses = [], screenshotBytes = null } = {}) {
        this.responses = [...responses];
        this.screenshotBytes = screenshotBytes;
        this.started = false;
        this.actions = [];
    }
    async start() { this.started = true; return { replay: true }; }
    async perform(action) {
        if (!this.started) throw new Error("Replay computer session is not started.");
        this.actions.push({ ...action });
        if (action.type === "computer_screenshot" && action.outputPath && this.screenshotBytes) {
            await fs.writeFile(action.outputPath, this.screenshotBytes);
        }
        const next = this.responses.length ? this.responses.shift() : {};
        if (next?.error) throw new Error(next.error);
        return { replay: true, ...next, ...(action.type === "computer_screenshot" ? { outputPath: action.outputPath ?? null } : {}) };
    }
    async stop() { this.started = false; }
    describe() { return { kind: "replay" }; }
}
