import path from "node:path";
import { buildRepositoryContext } from "./context.js";
import { runCommand } from "../core/command.js";

const HIGH_RISK_GOAL = /\b(delete|remove|drop|migrat(?:e|ion)|schema|database|credential|secret|auth(?:entication|orization)?|permission|security|deploy|release|publish|upgrade|dependency|dependencies)\b/i;
const MEDIUM_RISK_GOAL = /\b(refactor|rename|move|replace|rewrite|config|configuration|api|route|network|cache|storage)\b/i;
const HIGH_RISK_PATH = /(^|\/)(migrations?|database|infra|terraform|deploy|security|auth|permissions?|secrets?)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum)$/i;
const MEDIUM_RISK_PATH = /(^|\/)(package\.json|pyproject\.toml|pom\.xml|build\.gradle(?:\.kts)?|Dockerfile|docker-compose[^/]*|\.github\/workflows|config)(\/|$|\.)/i;

function riskLabel(points) {
    if (points >= 7) return "high";
    if (points >= 3) return "medium";
    return "low";
}

async function gitDirty(workspace) {
    const result = await runCommand({ command: "git", args: ["status", "--porcelain=v1", "--untracked-files=normal"], cwd: workspace, timeoutMs: 10000 });
    if (result.exitCode !== 0) return { available: false, entries: [] };
    const entries = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 100).map((line) => line.slice(3).trim());
    return { available: true, entries };
}

export async function buildPreflight(workspace, { goal = "", maxContextTokens = 4000 } = {}) {
    const repository = await buildRepositoryContext(workspace, { goal, maxContextTokens: Math.min(Number(maxContextTokens) || 4000, 4000), maxSelectedFiles: 12 });
    const selected = (repository.selectedFiles ?? []).map((item) => item.path);
    const tests = repository.testing?.selectedTests ?? [];
    const likelyTouched = [...new Set([...selected.slice(0, 8), ...tests.slice(0, 4)])];
    const dirty = await gitDirty(workspace);
    let points = 0;
    const reasons = [];
    if (HIGH_RISK_GOAL.test(goal)) { points += 4; reasons.push("Goal contains a high-impact operation or security/data/dependency term."); }
    else if (MEDIUM_RISK_GOAL.test(goal)) { points += 2; reasons.push("Goal suggests a structural or configuration change."); }
    const highPaths = likelyTouched.filter((item) => HIGH_RISK_PATH.test(item));
    const mediumPaths = likelyTouched.filter((item) => MEDIUM_RISK_PATH.test(item));
    if (highPaths.length) { points += 3; reasons.push(`Likely context includes high-impact paths: ${highPaths.slice(0, 3).join(", ")}`); }
    else if (mediumPaths.length) { points += 1; reasons.push(`Likely context includes configuration/build paths: ${mediumPaths.slice(0, 3).join(", ")}`); }
    if (dirty.entries.length) { points += 2; reasons.push(`Repository already has ${dirty.entries.length} dirty path(s); rollback must preserve pre-existing work.`); }
    if (repository.scan?.truncated) { points += 3; reasons.push("Repository scan was truncated, reducing confidence in scope analysis."); }
    if ((repository.scan?.fileCount ?? 0) > 5000) { points += 1; reasons.push("Large repository increases change-scope uncertainty."); }
    if (!reasons.length) reasons.push("No elevated change-risk signals detected from the goal and repository context.");
    const level = riskLabel(points);
    return {
        risk: { level, points, reasons },
        workspace: path.resolve(workspace),
        goal: String(goal ?? ""),
        repository: {
            fileCount: repository.scan?.fileCount ?? 0,
            scanSource: repository.scan?.source ?? null,
            projects: repository.projects ?? [],
            commandHints: repository.commandHints ?? [],
            selectedFiles: selected,
            selectedTests: tests
        },
        likelyTouched,
        dirty,
        checkpointRecommended: true,
        reviewRecommended: level !== "low"
    };
}
