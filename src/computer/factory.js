import { CdpComputerDriver } from "./cdp.js";
import { ReplayComputerDriver } from "./replay.js";
import { ComputerSession } from "./session.js";
import { WindowsUiComputerDriver } from "./windows-ui.js";

export function createComputerSession(config, { workspace, taskId, driverOverride = null } = {}) {
    const raw = config === true ? {} : (config && typeof config === "object" ? config : {});
    const enabled = config === true || raw.enabled === true;
    if (!enabled) return null;
    const kind = String(raw.driver ?? "cdp").toLowerCase();
    let driver = driverOverride;
    if (!driver) {
        if (kind === "cdp") driver = new CdpComputerDriver({ endpoint: raw.endpoint ?? "http://127.0.0.1:9222", targetHint: raw.targetHint ?? raw.target ?? null });
        else if (kind === "replay") driver = new ReplayComputerDriver({ responses: raw.responses ?? [], screenshotBytes: raw.screenshotBase64 ? Buffer.from(raw.screenshotBase64, "base64") : null });
        else if (kind === "windows" || kind === "windows-ui") driver = new WindowsUiComputerDriver({ powershell: raw.powershell ?? "powershell.exe" });
        else throw new Error(`Unsupported computer driver: ${kind}`);
    }
    return new ComputerSession({
        driver,
        workspace,
        taskId,
        policy: {
            allowedOrigins: raw.allowedOrigins,
            maxTypeChars: raw.maxTypeChars,
            maxWaitMs: raw.maxWaitMs,
            allowDataUrls: raw.allowDataUrls === true
        },
        persistTrace: raw.persistTrace !== false
    });
}
