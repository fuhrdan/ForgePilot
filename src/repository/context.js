import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";
import { scanRepository } from "./scanner.js";
import { detectProjects } from "./detector.js";
import { discoverTesting } from "../testing/discovery.js";

const TEXT_EXTENSIONS = new Set([
    ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".txt",
    ".cs", ".csproj", ".sln", ".java", ".kt", ".kts", ".xml", ".gradle",
    ".py", ".toml", ".go", ".rs", ".gd", ".godot", ".c", ".h", ".cpp", ".hpp",
    ".yml", ".yaml", ".html", ".css", ".scss", ".php", ".sql", ".ps1", ".sh"
]);

const PRIORITY_NAMES = new Set([
    "README.md", "package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml",
    "pom.xml", "build.gradle", "build.gradle.kts", "project.godot"
]);

function tokenizeGoal(goal) {
    return [...new Set(String(goal ?? "").toLowerCase().match(/[a-z0-9_\-]{3,}/g) ?? [])];
}

function scoreFile(file, goalTerms, projects) {
    const lower = file.toLowerCase();
    const base = path.basename(file);
    let score = PRIORITY_NAMES.has(base) ? 55 : 0;
    if (/^readme/i.test(base)) score += 15;
    if (/\.(test|spec)\.[^.]+$/i.test(base) || lower.includes("/test/") || lower.includes("/tests/")) score += 10;
    if (lower.includes("src/") || lower.startsWith("src/")) score += 15;
    for (const term of goalTerms) if (lower.includes(term)) score += 50;
    for (const project of projects) for (const manifest of project.manifests ?? []) if (file === manifest) score += 40;
    return score;
}

async function readText(workspace, file, maxChars) {
    const target = resolveInside(workspace, file);
    let stat;
    try { stat = await fs.stat(target); } catch { return null; }
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && !PRIORITY_NAMES.has(path.basename(file))) return null;
    const buffer = await fs.readFile(target);
    if (buffer.includes(0)) return null;
    const text = buffer.toString("utf8");
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

export async function buildRepositoryContext(workspace, {
    goal = "",
    maxContextTokens = 6000,
    maxFiles = 2000,
    maxSelectedFiles = 18
} = {}) {
    const scan = await scanRepository(workspace, { maxFiles });
    const projects = await detectProjects(workspace, scan.files);
    const terms = tokenizeGoal(goal);
    const ranked = [...scan.files]
        .map((file) => ({ file, score: scoreFile(file, terms, projects) }))
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

    const charBudget = Math.max(1000, Number(maxContextTokens) * 4);
    let remaining = charBudget;
    const excerpts = [];
    for (const item of ranked.slice(0, Math.max(maxSelectedFiles * 4, 40))) {
        if (excerpts.length >= maxSelectedFiles || remaining < 200) break;
        const perFile = Math.min(remaining, 2800);
        const text = await readText(workspace, item.file, perFile);
        if (text === null) continue;
        const used = Math.min(text.length, remaining);
        excerpts.push({ path: item.file, score: item.score, content: text.slice(0, used) });
        remaining -= used;
    }

    const commands = [];
    for (const project of projects) for (const hint of project.commands ?? []) {
        const key = `${hint.kind}:${hint.command}:${(hint.args ?? []).join(" ")}`;
        if (!commands.some((item) => item.key === key)) commands.push({ ...hint, key });
    }
    const commandHints = commands.map(({ key, ...rest }) => rest);
    const testing = await discoverTesting(workspace, scan.files, projects, commandHints, { goal });

    return {
        scan: { fileCount: scan.files.length, truncated: scan.truncated, source: scan.source },
        files: scan.files,
        projects,
        commandHints,
        testing,
        selectedFiles: excerpts,
        budget: {
            maxTokens: Number(maxContextTokens),
            approxTokensUsed: Math.ceil((charBudget - remaining) / 4),
            selectedFileCount: excerpts.length
        }
    };
}
