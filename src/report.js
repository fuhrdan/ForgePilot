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
        `- Task ID: ${report.taskId ?? "n/a"}`,
        `- Goal: ${report.goal}`,
        `- Mode: ${report.apply ? "APPLY" : "PLAN ONLY"}`,
        `- Result: ${report.status}`,
        `- Resumed: ${report.resumed ? "yes" : "no"}`,
        `- Repairs: ${report.repairCount ?? 0}/${report.maxRepairs ?? 0}`,
        "",
        "## Actions",
        ""
    ];

    for (const action of report.actions) {
        const phase = action.phase ? ` (${action.phase}${action.attempt ? ` #${action.attempt}` : ""})` : "";
        lines.push(`- ${action.index + 1}. ${action.type}${phase}: **${action.status}**`);
    }

    lines.push("", "## Repairs", "");
    if (!report.repairs?.length) lines.push("No repair attempts were required.");
    for (const repair of report.repairs ?? []) {
        lines.push(`### Attempt ${repair.attempt}`);
        lines.push("");
        lines.push(`- Trigger: ${repair.trigger?.kind ?? "unknown"}`);
        lines.push(`- Rationale: ${repair.rationale || "(none)"}`);
        lines.push(`- Repair actions: ${repair.actions?.length ?? 0}`);
        if (repair.retry?.status) lines.push(`- Failed-step retry: **${repair.retry.status}**`);
        if (typeof repair.retry?.passed === "boolean") lines.push(`- Re-verification: **${repair.retry.passed ? "PASS" : "FAIL"}**`);
        lines.push("");
    }

    lines.push("## Verification", "");
    if (report.verification.passed === null) lines.push("Verification not executed in plan-only mode.");
    else lines.push(`Overall: **${report.verification.passed ? "PASS" : "FAIL"}**`);
    if (report.verification.skipped) lines.push(`Reason: ${report.verification.skipped}`);

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
