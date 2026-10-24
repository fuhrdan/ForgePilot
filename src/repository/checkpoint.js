import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";
import { scanRepository } from "./scanner.js";

const CHECKPOINT_VERSION = 1;

async function sha256File(target) {
    try {
        const data = await fs.readFile(target);
        return crypto.createHash("sha256").update(data).digest("hex");
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

function normalize(relative) {
    return String(relative).replaceAll("\\", "/").replace(/^\.\//, "");
}

function checkpointRoot(workspace, id) {
    return resolveInside(workspace, path.posix.join(".forgepilot/checkpoints", String(id)));
}

async function writeManifest(root, manifest) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "checkpoint.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

async function readManifest(workspace, id) {
    const root = checkpointRoot(workspace, id);
    const manifest = JSON.parse(await fs.readFile(path.join(root, "checkpoint.json"), "utf8"));
    return { root, manifest };
}

async function snapshotFiles(workspace, files, snapshotDir, { maxTotalBytes, maxFileBytes }) {
    const manifestFiles = {};
    let totalBytes = 0;
    for (const relativeRaw of files) {
        const relative = normalize(relativeRaw);
        const source = resolveInside(workspace, relative);
        const stat = await fs.stat(source).catch(() => null);
        if (!stat?.isFile()) continue;
        if (stat.size > maxFileBytes) throw new Error(`Checkpoint refused: ${relative} is ${stat.size} bytes, above the per-file safety limit.`);
        totalBytes += stat.size;
        if (totalBytes > maxTotalBytes) throw new Error(`Checkpoint refused: repository snapshot exceeds ${maxTotalBytes} bytes.`);
        const target = path.join(snapshotDir, ...relative.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
        manifestFiles[relative] = {
            sha256: await sha256File(source),
            size: stat.size
        };
    }
    return { files: manifestFiles, totalBytes };
}

export async function createWorkspaceCheckpoint(workspace, id, {
    maxFiles = 10000,
    maxTotalBytes = 256 * 1024 * 1024,
    maxFileBytes = 64 * 1024 * 1024
} = {}) {
    const resolved = path.resolve(workspace);
    const scan = await scanRepository(resolved, { maxFiles });
    if (scan.truncated) throw new Error(`Checkpoint refused: repository scan exceeded ${maxFiles} files.`);
    const root = checkpointRoot(resolved, id);
    await fs.rm(root, { recursive: true, force: true });
    const snapshotDir = path.join(root, "files");
    const snapshot = await snapshotFiles(resolved, scan.files, snapshotDir, { maxTotalBytes, maxFileBytes });
    const manifest = {
        version: CHECKPOINT_VERSION,
        id: String(id),
        workspace: resolved,
        createdAt: new Date().toISOString(),
        scanSource: scan.source,
        fileCount: Object.keys(snapshot.files).length,
        totalBytes: snapshot.totalBytes,
        before: snapshot.files,
        postRun: null,
        changes: []
    };
    await writeManifest(root, manifest);
    return manifest;
}

export async function finalizeWorkspaceCheckpoint(workspace, id, { maxFiles = 10000 } = {}) {
    const resolved = path.resolve(workspace);
    const { root, manifest } = await readManifest(resolved, id);
    const scan = await scanRepository(resolved, { maxFiles });
    if (scan.truncated) throw new Error(`Checkpoint finalization refused: repository scan exceeded ${maxFiles} files.`);
    const current = {};
    for (const relativeRaw of scan.files) {
        const relative = normalize(relativeRaw);
        const target = resolveInside(resolved, relative);
        const stat = await fs.stat(target).catch(() => null);
        if (!stat?.isFile()) continue;
        current[relative] = { sha256: await sha256File(target), size: stat.size };
    }
    const before = manifest.before ?? {};
    const all = [...new Set([...Object.keys(before), ...Object.keys(current)])].sort();
    const changes = [];
    for (const relative of all) {
        const prior = before[relative] ?? null;
        const after = current[relative] ?? null;
        if (prior?.sha256 === after?.sha256) continue;
        changes.push({
            path: relative,
            status: prior === null ? "added" : after === null ? "deleted" : "modified",
            beforeSha256: prior?.sha256 ?? null,
            afterSha256: after?.sha256 ?? null,
            beforeSize: prior?.size ?? null,
            afterSize: after?.size ?? null
        });
    }
    manifest.finalizedAt = new Date().toISOString();
    manifest.postRun = current;
    manifest.changes = changes;
    await writeManifest(root, manifest);
    return manifest;
}

export async function inspectWorkspaceCheckpoint(workspace, id) {
    const { manifest } = await readManifest(path.resolve(workspace), id);
    return manifest;
}

export async function rollbackWorkspaceCheckpoint(workspace, id, { dryRun = false } = {}) {
    const resolved = path.resolve(workspace);
    const { root, manifest } = await readManifest(resolved, id);
    if (!manifest.postRun) throw new Error("Checkpoint has not been finalized and cannot be rolled back safely.");
    const conflicts = [];
    const operations = [];
    for (const change of manifest.changes ?? []) {
        const target = resolveInside(resolved, change.path);
        const currentSha256 = await sha256File(target);
        if (currentSha256 !== change.afterSha256) {
            conflicts.push({ path: change.path, expectedSha256: change.afterSha256, currentSha256 });
            continue;
        }
        operations.push({ path: change.path, status: change.status });
    }
    if (conflicts.length) {
        return { passed: false, dryRun, conflicts, restored: [], message: "Rollback blocked because files changed after ForgePilot completed." };
    }
    if (!dryRun) {
        for (const operation of operations) {
            const target = resolveInside(resolved, operation.path);
            if (operation.status === "added") {
                await fs.rm(target, { force: true });
            } else {
                const source = path.join(root, "files", ...operation.path.split("/"));
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(source, target);
            }
        }
    }
    const result = {
        passed: true,
        dryRun,
        conflicts: [],
        restored: operations,
        rolledBackAt: dryRun ? null : new Date().toISOString(),
        message: dryRun ? "Rollback can be applied safely." : "Rollback applied safely."
    };
    if (!dryRun) {
        manifest.rollback = result;
        await writeManifest(root, manifest);
    }
    return result;
}
