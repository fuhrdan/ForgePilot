import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveInside } from "../core/paths.js";

const EXCLUDED_DIRS = new Set([".forgepilot", "node_modules"]);

function excluded(relative, entryName) {
    const parts = relative.split(/[\\/]/).filter(Boolean);
    return EXCLUDED_DIRS.has(entryName) || parts.some((part) => EXCLUDED_DIRS.has(part));
}

async function copyWorkspace(source, target) {
    await fs.cp(source, target, {
        recursive: true,
        dereference: false,
        preserveTimestamps: true,
        filter(src) {
            const relative = path.relative(source, src);
            if (!relative) return true;
            const name = path.basename(src);
            return !excluded(relative, name);
        }
    });
}

async function manifest(root) {
    const files = new Map();
    async function visit(relative = "") {
        const directory = path.join(root, relative);
        let entries = [];
        try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (excluded(relative, entry.name)) continue;
            const rel = path.join(relative, entry.name);
            const absolute = path.join(root, rel);
            if (entry.isDirectory()) await visit(rel);
            else if (entry.isFile()) {
                const data = await fs.readFile(absolute);
                files.set(rel.split(path.sep).join("/"), crypto.createHash("sha256").update(data).digest("hex"));
            }
        }
    }
    await visit();
    return files;
}

async function promoteChanges(source, destination, before, after) {
    const changed = [];
    const all = new Set([...before.keys(), ...after.keys()]);
    for (const relative of [...all].sort()) {
        const oldHash = before.get(relative);
        const newHash = after.get(relative);
        if (oldHash === newHash) continue;
        const dest = resolveInside(destination, relative);
        if (newHash === undefined) {
            await fs.rm(dest, { force: true });
            changed.push({ path: relative, status: "deleted" });
        } else {
            const src = resolveInside(source, relative);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.copyFile(src, dest);
            changed.push({ path: relative, status: oldHash === undefined ? "added" : "modified" });
        }
    }
    return changed;
}

export async function createSandboxSession(originalWorkspace, { taskId = "task", keep = false } = {}) {
    const original = path.resolve(originalWorkspace);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "forgepilot-sandbox-"));
    const workspace = path.join(root, "workspace");
    await copyWorkspace(original, workspace);
    const before = await manifest(workspace);
    let closed = false;

    return {
        taskId,
        originalWorkspace: original,
        workspace,
        root,
        keep,
        async promote() {
            const after = await manifest(workspace);
            return promoteChanges(workspace, original, before, after);
        },
        async exportArtifacts(paths = []) {
            const exported = [];
            if (!paths.length) return exported;
            const destinationRoot = path.join(original, ".forgepilot", "artifacts", taskId);
            await fs.mkdir(destinationRoot, { recursive: true });
            for (const relative of paths) {
                const src = resolveInside(workspace, relative);
                try {
                    const stat = await fs.stat(src);
                    const dest = resolveInside(destinationRoot, relative);
                    await fs.mkdir(path.dirname(dest), { recursive: true });
                    if (stat.isDirectory()) await fs.cp(src, dest, { recursive: true });
                    else await fs.copyFile(src, dest);
                    exported.push({ path: relative, destination: dest });
                } catch { /* missing artifacts are reported by omission */ }
            }
            return exported;
        },
        async exportEvidence(paths = []) {
            const exported = [];
            for (const relative of paths) {
                const normalized = String(relative).replaceAll("\\", "/");
                if (!normalized.startsWith(".forgepilot/visual/")) continue;
                const src = resolveInside(workspace, normalized);
                try {
                    const stat = await fs.stat(src);
                    const dest = resolveInside(original, normalized);
                    await fs.mkdir(path.dirname(dest), { recursive: true });
                    if (stat.isDirectory()) await fs.cp(src, dest, { recursive: true });
                    else await fs.copyFile(src, dest);
                    exported.push({ path: normalized, destination: dest });
                } catch { /* missing evidence is reported by omission */ }
            }
            return exported;
        },
        async close({ preserve = keep } = {}) {
            if (closed) return;
            closed = true;
            if (!preserve) await fs.rm(root, { recursive: true, force: true });
        }
    };
}
