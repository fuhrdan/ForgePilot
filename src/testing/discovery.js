import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";

function tokenize(value) {
    return [...new Set(String(value ?? "").toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [])];
}

export function isTestFile(file) {
    const normalized = String(file).replaceAll("\\", "/").toLowerCase();
    const base = path.posix.basename(normalized);
    return normalized.includes("/test/") || normalized.startsWith("test/") ||
        normalized.includes("/tests/") || normalized.startsWith("tests/") ||
        normalized.includes("/spec/") || normalized.startsWith("spec/") ||
        /\.(test|spec)\.(js|mjs|cjs|ts|tsx|jsx)$/.test(base) ||
        /^test_.*\.py$/.test(base) || /_test\.py$/.test(base) ||
        /_test\.go$/.test(base) || /tests?\.cs$/.test(base) ||
        /test\.java$/.test(base) || /^test_.*\.gd$/.test(base);
}

function scoreTest(file, terms, sourcePaths = []) {
    const lower = file.toLowerCase();
    let score = 10;
    for (const term of terms) if (lower.includes(term)) score += 40;
    for (const source of sourcePaths) {
        const stem = path.posix.basename(source).replace(/\.[^.]+$/, "").toLowerCase();
        if (stem.length >= 3 && lower.includes(stem)) score += 35;
    }
    if (/\.(test|spec)\./.test(lower)) score += 8;
    if (lower.startsWith("test/") || lower.startsWith("tests/")) score += 5;
    return score;
}

async function readPackage(workspace) {
    try {
        return JSON.parse(await fs.readFile(resolveInside(workspace, "package.json"), "utf8"));
    } catch {
        return null;
    }
}

function cloneCommand(command) {
    return command ? { command: command.command, args: [...(command.args ?? [])], kind: command.kind } : null;
}

async function deriveTargetedCommand(workspace, projects, selectedTests) {
    if (!selectedTests.length) return null;
    const node = projects.find((project) => project.ecosystem === "node");
    if (node) {
        const pkg = await readPackage(workspace);
        const script = String(pkg?.scripts?.test ?? "");
        if (/\bnode\s+--test\b/.test(script)) {
            return { kind: "targeted-test", command: "node", args: ["--test", ...selectedTests] };
        }
    }

    if (projects.some((project) => project.ecosystem === "python")) {
        return { kind: "targeted-test", command: "pytest", args: [...selectedTests] };
    }

    return null;
}

export async function discoverTesting(workspace, files, projects, commandHints, {
    goal = "",
    sourcePaths = [],
    maxSelectedTests = 6
} = {}) {
    const terms = tokenize(goal);
    const testFiles = files.filter(isTestFile).sort();
    const rankedTests = testFiles
        .map((file) => ({ file, score: scoreTest(file, terms, sourcePaths) }))
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    const relevantTests = rankedTests.filter((item) => item.score > 23);
    const selectedTests = (relevantTests.length ? relevantTests : rankedTests)
        .slice(0, maxSelectedTests)
        .map((item) => item.file);

    const testCommands = commandHints.filter((hint) => hint.kind === "test");
    const buildCommands = commandHints.filter((hint) => hint.kind === "build");
    const primaryTestCommand = cloneCommand(testCommands[0] ?? null);
    const targetedTestCommand = await deriveTargetedCommand(workspace, projects, selectedTests);

    return {
        testFileCount: testFiles.length,
        testFiles,
        selectedTests,
        primaryTestCommand,
        targetedTestCommand,
        regressionCommand: cloneCommand(primaryTestCommand),
        buildCommands: buildCommands.map(cloneCommand)
    };
}

export function testPathAllowed(relative, allowedPatterns = []) {
    const normalized = String(relative ?? "").replaceAll("\\", "/");
    if (isTestFile(normalized)) return true;
    return allowedPatterns.some((pattern) => {
        const value = String(pattern).replaceAll("\\", "/");
        if (value.endsWith("/**")) return normalized.startsWith(value.slice(0, -3));
        if (value.endsWith("/")) return normalized.startsWith(value);
        return normalized === value;
    });
}
