import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";

async function readIfExists(workspace, relative) {
    try { return await fs.readFile(resolveInside(workspace, relative), "utf8"); }
    catch { return null; }
}

function pct(covered, total) {
    return total > 0 ? Math.round((covered / total) * 10000) / 100 : null;
}

function parseLcov(text) {
    let linesFound = 0;
    let linesHit = 0;
    let functionsFound = 0;
    let functionsHit = 0;
    let branchesFound = 0;
    let branchesHit = 0;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("LF:")) linesFound += Number(line.slice(3)) || 0;
        else if (line.startsWith("LH:")) linesHit += Number(line.slice(3)) || 0;
        else if (line.startsWith("FNF:")) functionsFound += Number(line.slice(4)) || 0;
        else if (line.startsWith("FNH:")) functionsHit += Number(line.slice(4)) || 0;
        else if (line.startsWith("BRF:")) branchesFound += Number(line.slice(4)) || 0;
        else if (line.startsWith("BRH:")) branchesHit += Number(line.slice(4)) || 0;
    }
    return {
        format: "lcov",
        lines: { covered: linesHit, total: linesFound, pct: pct(linesHit, linesFound) },
        functions: { covered: functionsHit, total: functionsFound, pct: pct(functionsHit, functionsFound) },
        branches: { covered: branchesHit, total: branchesFound, pct: pct(branchesHit, branchesFound) }
    };
}

function normalizeSummaryMetric(metric) {
    if (!metric || typeof metric !== "object") return null;
    const total = Number(metric.total ?? 0);
    const covered = Number(metric.covered ?? 0);
    return { covered, total, pct: Number.isFinite(Number(metric.pct)) ? Number(metric.pct) : pct(covered, total) };
}

function parseCoverageSummary(text) {
    const data = JSON.parse(text);
    const total = data.total ?? data;
    return {
        format: "coverage-summary-json",
        lines: normalizeSummaryMetric(total.lines),
        functions: normalizeSummaryMetric(total.functions),
        branches: normalizeSummaryMetric(total.branches),
        statements: normalizeSummaryMetric(total.statements)
    };
}

export async function collectCoverage(workspace) {
    const candidates = [
        "coverage/lcov.info",
        "lcov.info",
        "coverage/coverage-summary.json",
        "coverage-summary.json"
    ];

    for (const relative of candidates) {
        const text = await readIfExists(workspace, relative);
        if (text === null) continue;
        try {
            const summary = relative.endsWith(".json") ? parseCoverageSummary(text) : parseLcov(text);
            return { available: true, path: relative, ...summary };
        } catch {
            // Try the next known coverage artifact rather than failing the engineering task.
        }
    }
    return { available: false };
}
