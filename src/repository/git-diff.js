import crypto from "node:crypto";
import fs from "node:fs/promises";
import { runCommand } from "../core/command.js";
import { resolveInside } from "../core/paths.js";
import { scanRepository } from "./scanner.js";

async function isGitRepository(workspace) {
    const result = await runCommand({ command: "git", args: ["rev-parse", "--is-inside-work-tree"], cwd: workspace, timeoutMs: 10000 });
    return result.exitCode === 0 && result.stdout.trim() === "true";
}

async function hashFile(workspace, relative) {
    const target = resolveInside(workspace, relative);
    try {
        const data = await fs.readFile(target);
        return crypto.createHash("sha256").update(data).digest("hex");
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

export async function captureGitBaseline(workspace) {
    if (!await isGitRepository(workspace)) return { isRepository: false, files: {}, head: null };
    const headResult = await runCommand({ command: "git", args: ["rev-parse", "HEAD"], cwd: workspace, timeoutMs: 10000 });
    const scan = await scanRepository(workspace, { maxFiles: 10000 });
    const fingerprints = {};
    for (const file of scan.files) fingerprints[file] = await hashFile(workspace, file);
    return {
        isRepository: true,
        head: headResult.exitCode === 0 ? headResult.stdout.trim() : null,
        files: fingerprints,
        truncated: scan.truncated
    };
}

export async function summarizeGitDiff(workspace, baseline, expectedPaths = []) {
    if (!baseline?.isRepository || !await isGitRepository(workspace)) {
        return { available: false, changedFiles: [], unexpectedFiles: [], summary: { added: 0, modified: 0, deleted: 0 } };
    }

    const scan = await scanRepository(workspace, { maxFiles: 10000 });
    const currentFiles = new Set(scan.files);
    const beforeFiles = new Set(Object.keys(baseline.files ?? {}));
    const all = [...new Set([...beforeFiles, ...currentFiles])].sort();
    const changedFiles = [];

    for (const file of all) {
        const before = baseline.files?.[file] ?? null;
        const after = currentFiles.has(file) ? await hashFile(workspace, file) : null;
        if (before === after) continue;
        const status = before === null ? "added" : after === null ? "deleted" : "modified";
        changedFiles.push({ path: file, status });
    }

    const normalizedExpected = expectedPaths.map((item) => String(item).replaceAll("\\", "/"));
    const isExpected = (file) => normalizedExpected.some((expected) => {
        if (expected.endsWith("/**")) return file.startsWith(expected.slice(0, -3));
        if (expected.endsWith("/")) return file.startsWith(expected);
        return file === expected;
    });
    const unexpectedFiles = changedFiles.filter((item) => !isExpected(item.path));
    const summary = { added: 0, modified: 0, deleted: 0 };
    for (const item of changedFiles) summary[item.status]++;

    const nameStatus = await runCommand({ command: "git", args: ["diff", "--name-status", "HEAD", "--"], cwd: workspace, timeoutMs: 20000 });
    return {
        available: true,
        incomplete: Boolean(baseline.truncated || scan.truncated),
        headBefore: baseline.head,
        changedFiles,
        unexpectedFiles,
        summary,
        gitNameStatus: nameStatus.exitCode === 0 ? nameStatus.stdout.trim() : ""
    };
}
