import fs from "node:fs/promises";
import path from "node:path";

function safeTimestamp(date = new Date()) {
    return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export async function writeReport(workspace, report) {
    const runId = safeTimestamp();
    const directory = path.join(workspace, ".forgepilot", "runs", runId);
    await fs.mkdir(directory, { recursive: true });
    const jsonPath = path.join(directory, "report.json");
    const markdownPath = path.join(directory, "report.md");
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    await fs.writeFile(markdownPath, renderMarkdown(report), "utf8");
    return { runId, jsonPath, markdownPath };
}

function renderMarkdown(report) {
    const lines = [
        "# ForgePilot Task Report",
        "",
        `- Version: ${report.version}`,
        `- Goal: ${report.goal}`,
        `- Mode: ${report.apply ? "APPLY" : "PLAN ONLY"}`,
        `- Result: ${report.status}`,
        "",
        "## Actions",
        ""
    ];

    for (const action of report.actions) {
        lines.push(`- ${action.index + 1}. ${action.type}: **${action.status}**`);
    }

    lines.push("", "## Verification", "");
    if (report.verification.passed === null) lines.push("Verification not executed in plan-only mode.");
    else lines.push(`Overall: **${report.verification.passed ? "PASS" : "FAIL"}**`);

    for (const check of report.verification.checks) {
        lines.push(`- ${check.index + 1}. ${check.type}: **${check.status}**`);
    }

    lines.push("", "## Git", "");
    lines.push(`- Repository: ${report.verification.git.isRepository ? "yes" : "no"}`);
    if (report.verification.git.branch) lines.push(`- Branch: ${report.verification.git.branch}`);
    lines.push(`- Working tree changes: ${report.verification.git.porcelain ? "yes" : "no"}`);
    lines.push("");
    return lines.join("\n");
}
