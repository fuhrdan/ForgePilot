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
        ""
    ];

    if (report.repository) {
        lines.push("## Repository Intelligence", "");
        lines.push(`- Files discovered: ${report.repository.scan.fileCount}${report.repository.scan.truncated ? "+" : ""}`);
        lines.push(`- Scanner: ${report.repository.scan.source}`);
        lines.push(`- AI context: ~${report.repository.budget.approxTokensUsed}/${report.repository.budget.maxTokens} tokens from ${report.repository.budget.selectedFileCount} files`);
        for (const project of report.repository.projects ?? []) {
            const frameworks = project.frameworks?.length ? `; ${project.frameworks.join(", ")}` : "";
            lines.push(`- Project: ${project.ecosystem} / ${project.language}${frameworks}`);
        }
        if (report.repository.commandHints?.length) {
            lines.push("", "Suggested commands:");
            for (const hint of report.repository.commandHints) lines.push(`- ${hint.kind}: \`${hint.command} ${(hint.args ?? []).join(" ")}\``);
        }
        lines.push("");
    }


    if (report.testFirst?.enabled) {
        lines.push("## Test-First Evidence", "");
        lines.push(`- Test authoring actions: ${report.testFirst.authoring?.length ?? 0}`);
        lines.push(`- RED gate: **${report.testFirst.red?.validRed ? "PASS" : "FAIL"}**`);
        if (report.testFirst.red?.reason) lines.push(`- RED evidence: ${report.testFirst.red.reason}`);
        if (report.testFirst.red?.command) lines.push(`- RED command: \`${report.testFirst.red.command} ${(report.testFirst.red.args ?? []).join(" ")}\``);
        if (report.testFirst.selectedTests?.length) lines.push(`- Selected tests: ${report.testFirst.selectedTests.map((item) => `\`${item}\``).join(", ")}`);
        if (report.testFirst.testOnlyDiff?.available) lines.push(`- Test-only changes before implementation: ${report.testFirst.testOnlyDiff.changedFiles?.length ?? 0}`);
        lines.push("");
    }

    lines.push("## Actions", "");
    for (const action of report.actions) {
        const phase = action.phase ? ` (${action.phase}${action.attempt ? ` #${action.attempt}` : ""})` : "";
        lines.push(`- ${action.index + 1}. ${action.type}${phase}: **${action.status}**`);
    }

    lines.push("", "## Repairs", "");
    if (!report.repairs?.length) lines.push("No repair attempts were required.");
    for (const repair of report.repairs ?? []) {
        lines.push(`### Attempt ${repair.attempt}`, "");
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
        const phase = check.phase ? ` [${check.phase}]` : "";
        lines.push(`- ${check.index + 1}. ${check.type}${phase}: **${check.status}**`);
    }

    lines.push("", "## Coverage", "");
    if (report.coverage?.available) {
        lines.push(`- Source: \`${report.coverage.path}\` (${report.coverage.format})`);
        for (const metric of ["lines", "functions", "branches", "statements"]) {
            const value = report.coverage[metric];
            if (value && value.total > 0) lines.push(`- ${metric}: ${value.covered}/${value.total} (${value.pct}%)`);
        }
    } else lines.push("No supported coverage artifact was found; coverage is informational in v0.4.");

    lines.push("", "## Git", "");
    lines.push(`- Repository: ${report.verification.git.isRepository ? "yes" : "no"}`);
    if (report.verification.git.branch) lines.push(`- Branch: ${report.verification.git.branch}`);
    lines.push(`- Working tree changes: ${report.verification.git.porcelain ? "yes" : "no"}`);

    const diff = report.verification.gitDiff;
    if (diff?.available) {
        lines.push(`- Changes since ForgePilot baseline: ${diff.changedFiles.length}`);
        lines.push(`- Added / modified / deleted: ${diff.summary.added} / ${diff.summary.modified} / ${diff.summary.deleted}`);
        lines.push(`- Unexpected changed files: ${diff.unexpectedFiles.length}`);
        if (diff.changedFiles.length) {
            lines.push("", "### Change Summary", "");
            for (const item of diff.changedFiles) {
                const unexpected = diff.unexpectedFiles.some((candidate) => candidate.path === item.path) ? " — **UNEXPECTED**" : "";
                lines.push(`- ${item.status}: \`${item.path}\`${unexpected}`);
            }
        }
    }

    lines.push("");
    return lines.join("\n");
}
