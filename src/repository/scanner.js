import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../core/command.js";
import { resolveInside } from "../core/paths.js";

const ALWAYS_IGNORE = new Set([
    ".git", ".forgepilot", "node_modules", ".venv", "venv", "vendor",
    "bin", "obj", "target", "dist", "build", ".next", ".gradle", ".idea"
]);

function normalize(value) {
    return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globToRegExp(pattern) {
    let source = "";
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === "*") {
            if (pattern[i + 1] === "*") {
                i++;
                if (pattern[i + 1] === "/") {
                    i++;
                    source += "(?:.*/)?";
                } else source += ".*";
            } else source += "[^/]*";
        } else if (ch === "?") source += "[^/]";
        else if (".+^${}()|[]\\".includes(ch)) source += `\\${ch}`;
        else source += ch;
    }
    return new RegExp(`^${source}${pattern.endsWith("/") ? ".*" : "$"}`);
}

async function readIgnoreRules(workspace) {
    const ignorePath = resolveInside(workspace, ".gitignore");
    let text = "";
    try { text = await fs.readFile(ignorePath, "utf8"); } catch { return []; }

    return text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((raw) => {
            const negate = raw.startsWith("!");
            let pattern = normalize(negate ? raw.slice(1) : raw);
            const anchored = pattern.startsWith("/");
            pattern = pattern.replace(/^\//, "");
            const directoryOnly = pattern.endsWith("/");
            if (!anchored && !pattern.includes("/")) pattern = `**/${pattern}`;
            return { negate, regex: globToRegExp(pattern), directoryOnly };
        });
}

function isIgnored(relative, rules) {
    const normalized = normalize(relative);
    const pieces = normalized.split("/");
    if (pieces.some((piece) => ALWAYS_IGNORE.has(piece))) return true;

    let ignored = false;
    for (const rule of rules) {
        if (rule.regex.test(normalized)) ignored = !rule.negate;
    }
    return ignored;
}

async function gitFiles(workspace) {
    const inside = await runCommand({
        command: "git", args: ["rev-parse", "--is-inside-work-tree"], cwd: workspace, timeoutMs: 10000
    });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return null;

    const result = await runCommand({
        command: "git",
        args: ["ls-files", "-co", "--exclude-standard", "-z"],
        cwd: workspace,
        timeoutMs: 30000
    });
    if (result.exitCode !== 0) return null;
    return result.stdout.split("\0")
        .filter(Boolean)
        .map(normalize)
        .filter((file) => !file.split("/").some((piece) => ALWAYS_IGNORE.has(piece)))
        .sort();
}

async function walkFiles(workspace, maxFiles) {
    const rules = await readIgnoreRules(workspace);
    const files = [];

    async function visit(relative = "") {
        if (files.length >= maxFiles) return;
        const directory = resolveInside(workspace, relative || ".");
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); }
        catch { return; }
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            if (files.length >= maxFiles) break;
            const next = normalize(path.posix.join(normalize(relative), entry.name));
            if (isIgnored(next + (entry.isDirectory() ? "/" : ""), rules)) continue;
            if (entry.isDirectory()) await visit(next);
            else if (entry.isFile()) files.push(next);
        }
    }

    await visit();
    return files;
}

export async function scanRepository(workspace, { maxFiles = 2000 } = {}) {
    const fromGit = await gitFiles(workspace);
    const files = fromGit ?? await walkFiles(workspace, maxFiles);
    return {
        files: files.slice(0, maxFiles),
        truncated: files.length > maxFiles,
        source: fromGit ? "git" : "filesystem"
    };
}
