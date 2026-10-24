import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createDashboardServer } from "../dashboard/server.js";
import { loadMachineConfig } from "./system-inspector.js";

export async function defaultWorkspace({ env = process.env, homedir = os.homedir(), platform = process.platform } = {}) {
    if (env.FORGEPILOT_WORKSPACE) return path.resolve(env.FORGEPILOT_WORKSPACE);
    if (platform === "win32") return path.join(homedir, "Documents", "ForgePilot Workspace");
    return path.join(homedir, "ForgePilot Workspace");
}

export async function openLocalUrl(url, { platform = process.platform, runner = spawn } = {}) {
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url) && !/^http:\/\/localhost:\d+\//.test(url)) throw new Error("Refusing to open non-loopback launcher URL.");
    try {
        if (platform === "win32") runner("cmd.exe", ["/d", "/s", "/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref?.();
        else if (platform === "darwin") runner("open", [url], { detached: true, stdio: "ignore" }).unref?.();
        else runner("xdg-open", [url], { detached: true, stdio: "ignore" }).unref?.();
        return true;
    } catch {
        return false;
    }
}

export async function launchForgePilot({ workspace, port = 3210, openBrowser = true } = {}) {
    const resolved = path.resolve(workspace ?? await defaultWorkspace());
    await fs.mkdir(resolved, { recursive: true });
    const machineConfig = await loadMachineConfig().catch(() => null);
    const dashboard = await createDashboardServer({ workspace: resolved, port, launcher: { machineConfig } });
    const url = `http://${dashboard.host}:${dashboard.port}/`;
    if (openBrowser) await openLocalUrl(url);
    return { ...dashboard, url, machineConfig };
}
