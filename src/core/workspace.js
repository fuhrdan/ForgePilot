import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./command.js";
import { resolveInside } from "./paths.js";

export async function ensureWorkspace(workspace) {
    const resolved = path.resolve(workspace);
    await fs.mkdir(resolved, { recursive: true });
    await fs.mkdir(path.join(resolved, ".forgepilot", "runs"), { recursive: true });
    return resolved;
}

export async function initializeWorkspace(workspace) {
    const resolved = await ensureWorkspace(workspace);
    const configPath = resolveInside(resolved, ".forgepilot/config.json");
    try {
        await fs.access(configPath);
    } catch {
        await fs.writeFile(configPath, JSON.stringify({ version: 1, allowedCommands: [] }, null, 2) + "\n", "utf8");
    }
    return resolved;
}

export async function getGitStatus(workspace) {
    const inside = await runCommand({ command: "git", args: ["rev-parse", "--is-inside-work-tree"], cwd: workspace, timeoutMs: 10000 });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
        return { isRepository: false, branch: null, porcelain: "" };
    }

    const [branch, status] = await Promise.all([
        runCommand({ command: "git", args: ["branch", "--show-current"], cwd: workspace, timeoutMs: 10000 }),
        runCommand({ command: "git", args: ["status", "--porcelain"], cwd: workspace, timeoutMs: 10000 })
    ]);

    const porcelain = status.stdout.split(/\r?\n/).filter((line) => {
        if (!line.trim()) return false;
        const file = line.length > 3 ? line.slice(3).replace(/^"|"$/g, "") : line;
        return !file.startsWith(".forgepilot/") && file !== ".forgepilot";
    }).join("\n").trim();

    return {
        isRepository: true,
        branch: branch.stdout.trim() || null,
        porcelain
    };
}

export async function summarizeWorkspace(workspace, maxFiles = 200) {
    const files = [];

    async function visit(relative = "") {
        if (files.length >= maxFiles) return;
        const directory = resolveInside(workspace, relative || ".");
        const entries = await fs.readdir(directory, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            if (files.length >= maxFiles) break;
            if ([".git", "node_modules", ".forgepilot"].includes(entry.name)) continue;
            const next = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(next);
            else files.push(next.replaceAll("\\", "/"));
        }
    }

    await visit();
    return files;
}
