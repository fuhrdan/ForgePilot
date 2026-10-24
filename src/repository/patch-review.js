import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";
import { inspectWorkspaceCheckpoint } from "./checkpoint.js";

function normalize(relative) {
    return String(relative).replaceAll("\\", "/").replace(/^\.\//, "");
}

function sensitivityForPath(relative) {
    const value = normalize(relative).toLowerCase();
    const high = [
        /(^|\/)auth([\/._-]|$)/,
        /security/,
        /permission/,
        /credential/,
        /secret/,
        /migration/,
        /schema/,
        /deploy/,
        /production/,
        /terraform/,
        /kubernetes|k8s/,
        /dockerfile$/,
        /(^|\/)\.github\/workflows\//,
        /package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|cargo\.lock$|packages\.lock\.json$/
    ];
    if (high.some((pattern) => pattern.test(value))) return "high";
    if (/(^|\/)(config|infra|scripts?|ci)(\/|$)/.test(value) || /package\.json$|\.csproj$|pom\.xml$|build\.gradle/.test(value)) return "medium";
    if (/(^|\/)(test|tests|spec|docs?)(\/|$)/.test(value) || /\.md$/.test(value)) return "low";
    return "normal";
}

function isProbablyText(buffer) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
    if (sample.includes(0)) return false;
    let controls = 0;
    for (const byte of sample) {
        if (byte < 9 || (byte > 13 && byte < 32)) controls++;
    }
    return sample.length === 0 || controls / sample.length < 0.02;
}

function splitLines(buffer) {
    return buffer.toString("utf8").replace(/\r\n/g, "\n").split("\n");
}

function lineDelta(beforeLines, afterLines) {
    let prefix = 0;
    const shared = Math.min(beforeLines.length, afterLines.length);
    while (prefix < shared && beforeLines[prefix] === afterLines[prefix]) prefix++;
    let suffix = 0;
    while (
        suffix < shared - prefix &&
        beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
    ) suffix++;
    const beforeMiddle = Math.max(0, beforeLines.length - prefix - suffix);
    const afterMiddle = Math.max(0, afterLines.length - prefix - suffix);
    return {
        addedLines: Math.max(0, afterMiddle - beforeMiddle),
        deletedLines: Math.max(0, beforeMiddle - afterMiddle),
        modifiedLines: Math.min(beforeMiddle, afterMiddle),
        unchangedPrefixLines: prefix,
        unchangedSuffixLines: suffix
    };
}

async function readMaybe(target, maxBytes) {
    try {
        const stat = await fs.stat(target);
        if (!stat.isFile()) return null;
        if (stat.size > maxBytes) return { tooLarge: true, size: stat.size, buffer: null };
        return { tooLarge: false, size: stat.size, buffer: await fs.readFile(target) };
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

export async function buildPatchReview(workspace, checkpointId, {
    maxFiles = 250,
    maxTextBytes = 512 * 1024
} = {}) {
    const resolved = path.resolve(workspace);
    const manifest = await inspectWorkspaceCheckpoint(resolved, checkpointId);
    if (!manifest.postRun) throw new Error("Checkpoint has not been finalized; patch review is unavailable.");
    const changes = Array.isArray(manifest.changes) ? manifest.changes : [];
    const limited = changes.slice(0, maxFiles);
    const files = [];

    for (const change of limited) {
        const relative = normalize(change.path);
        const beforePath = resolveInside(resolved, path.posix.join(".forgepilot/checkpoints", String(checkpointId), "files", relative));
        const afterPath = resolveInside(resolved, relative);
        const [before, after] = await Promise.all([
            change.status === "added" ? Promise.resolve(null) : readMaybe(beforePath, maxTextBytes),
            change.status === "deleted" ? Promise.resolve(null) : readMaybe(afterPath, maxTextBytes)
        ]);
        const anyTooLarge = Boolean(before?.tooLarge || after?.tooLarge);
        const text = !anyTooLarge && (before?.buffer == null || isProbablyText(before.buffer)) && (after?.buffer == null || isProbablyText(after.buffer));
        let lines = null;
        if (text) {
            const beforeLines = before?.buffer ? splitLines(before.buffer) : [];
            const afterLines = after?.buffer ? splitLines(after.buffer) : [];
            lines = lineDelta(beforeLines, afterLines);
            lines.before = beforeLines.length;
            lines.after = afterLines.length;
        }
        files.push({
            path: relative,
            status: change.status,
            sensitivity: sensitivityForPath(relative),
            binary: !text,
            oversized: anyTooLarge,
            beforeBytes: change.beforeSize ?? before?.size ?? null,
            afterBytes: change.afterSize ?? after?.size ?? null,
            lines
        });
    }

    const summary = {
        fileCount: changes.length,
        reviewedFiles: files.length,
        truncated: changes.length > maxFiles,
        addedFiles: changes.filter((item) => item.status === "added").length,
        modifiedFiles: changes.filter((item) => item.status === "modified").length,
        deletedFiles: changes.filter((item) => item.status === "deleted").length,
        textFiles: files.filter((item) => !item.binary).length,
        binaryFiles: files.filter((item) => item.binary).length,
        sensitiveFiles: files.filter((item) => item.sensitivity === "high" || item.sensitivity === "medium").length,
        estimatedAddedLines: files.reduce((sum, item) => sum + Number(item.lines?.addedLines ?? 0), 0),
        estimatedDeletedLines: files.reduce((sum, item) => sum + Number(item.lines?.deletedLines ?? 0), 0),
        estimatedModifiedLines: files.reduce((sum, item) => sum + Number(item.lines?.modifiedLines ?? 0), 0)
    };

    return {
        version: 1,
        checkpointId: String(checkpointId),
        generatedAt: new Date().toISOString(),
        summary,
        files,
        privacy: "No source file contents are stored in this patch review; only metadata and line/size deltas are retained."
    };
}

export { sensitivityForPath, lineDelta };
