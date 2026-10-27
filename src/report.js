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

    if (report.profile) {
        lines.push("## Product Profile", "");
        lines.push(`- Profile: ${report.profile.name}`);
        lines.push(`- Hardware: ${report.profile.hardware?.memoryGiB ?? "?"} GiB RAM / ${report.profile.hardware?.logicalCpus ?? "?"} logical CPUs`);
        lines.push(`- Context budget: ${report.profile.maxContextTokens ?? "default"}`);
        lines.push("");
    }

    if (report.confidence) {
        lines.push("## Evidence Confidence", "");
        lines.push(`- Score: **${report.confidence.score}/100 (${String(report.confidence.label ?? "unknown").toUpperCase()})**`);
        lines.push(`- Interpretation: ${report.confidence.interpretation ?? "Deterministic evidence-quality score."}`);
        for (const item of report.confidence.positives ?? []) lines.push(`- +${item.points}: ${item.reason}`);
        for (const item of report.confidence.deductions ?? []) lines.push(`- ${item.points}: ${item.reason}`);
        if (report.confidence.gaps?.length) {
            lines.push("", "Evidence gaps:");
            for (const gap of report.confidence.gaps) lines.push(`- ${gap}`);
        }
        lines.push("");
    }

    if (report.security) {
        lines.push("## Security / Permissions", "");
        lines.push(`- Secret references: ${report.security.secrets?.length ?? 0}`);
        lines.push(`- Required approval categories: ${(report.security.approvals?.required ?? []).join(", ") || "none"}`);
        lines.push(`- Explicit grants: ${(report.security.approvals?.granted ?? []).join(", ") || "none"}`);
        lines.push(`- Approval decisions recorded: ${report.security.approvals?.decisions?.length ?? 0}`);
        for (const secret of report.security.secrets ?? []) lines.push(`- Secret ${secret.alias}: env ${secret.env} (${secret.available ? "available" : "missing"})`);
        lines.push("");
    }

    if (report.deliverable) {
        lines.push("## Finished Deliverable", "");
        if (report.deliverable.unavailable) {
            lines.push(`- Packaging unavailable: ${report.deliverable.error ?? "unknown error"}`);
        } else {
            lines.push(`- Project: ${report.deliverable.project?.name ?? "unknown"} (${report.deliverable.project?.ecosystem ?? "unknown"})`);
            if (report.deliverable.primary?.path) lines.push(`- Primary output: \`${report.deliverable.primary.path}\``);
            lines.push(`- Artifacts: ${report.deliverable.artifacts?.length ?? 0}`);
            if (report.deliverable.launcher?.entry) lines.push(`- Runnable entry: \`${report.deliverable.launcher.entry}\``);
        }
        lines.push("");
    }

    if (report.sandbox?.enabled) {
        lines.push("## Sandbox", "");
        lines.push(`- Provider: ${report.sandbox.provider?.kind ?? "unknown"}`);
        if (report.sandbox.provider?.runtime) lines.push(`- Runtime: ${report.sandbox.provider.runtime}`);
        if (report.sandbox.provider?.image) lines.push(`- Image: \`${report.sandbox.provider.image}\``);
        if (report.sandbox.provider?.network) lines.push(`- Network: ${report.sandbox.provider.network}`);
        if (report.sandbox.provider?.memory) lines.push(`- Memory limit: ${report.sandbox.provider.memory}`);
        if (report.sandbox.provider?.cpus) lines.push(`- CPU limit: ${report.sandbox.provider.cpus}`);
        lines.push(`- Promoted to host workspace: ${report.sandbox.promoted ? "yes" : "no"}`);
        lines.push(`- Promoted file changes: ${report.sandbox.promotedChanges?.length ?? 0}`);
        lines.push(`- Exported artifacts: ${report.sandbox.artifacts?.length ?? 0}`);
        lines.push("");
    }

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

    if (report.visual?.enabled) {
        lines.push("## Visual Verification", "");
        const result = report.visual.passed === null ? "PLANNED" : (report.visual.passed ? "PASS" : "FAIL");
        lines.push(`- Overall: **${result}**`);
        lines.push(`- Evidence images: ${report.visual.evidencePaths?.length ?? 0}`);
        if (report.visionProvider) {
            lines.push(`- Vision provider: ${report.visionProvider.kind ?? "unknown"}${report.visionProvider.model ? ` / ${report.visionProvider.model}` : ""}`);
        }
        for (const check of report.visual.checks ?? []) {
            const checkpoint = check.checkpoint ? ` [${check.checkpoint}]` : "";
            lines.push(`- ${check.type}${checkpoint}: **${String(check.status ?? (check.passed ? "passed" : "failed")).toUpperCase()}**`);
            if (check.type === "pixel_diff" && check.changedRatio !== undefined) {
                lines.push(`  - changed ratio: ${Number(check.changedRatio).toFixed(6)}; mean delta: ${Number(check.meanDelta ?? 0).toFixed(3)}; RMS delta: ${Number(check.rmsDelta ?? 0).toFixed(3)}`);
            }
            if (check.type === "vision" && check.summary) lines.push(`  - ${check.summary}`);
            if (check.evidence) lines.push(`  - evidence: \`${check.evidence}\``);
            if (check.error) lines.push(`  - error: ${check.error}`);
        }
        lines.push("");
    }


    if (report.computer?.enabled) {
        lines.push("## Computer / IDE Control", "");
        lines.push(`- Driver: ${report.computer.driver?.kind ?? "unknown"}`);
        if (report.computer.driver?.endpoint) lines.push(`- Endpoint: ${report.computer.driver.endpoint}`);
        if (report.computer.driver?.targetHint) lines.push(`- Target hint: ${report.computer.driver.targetHint}`);
        lines.push(`- Interaction actions: ${report.computer.actions ?? 0}`);
        lines.push(`- Passed / failed: ${report.computer.passed ?? 0} / ${report.computer.failed ?? 0}`);
        if (report.computer.tracePath) lines.push(`- Replayable trace: \`${report.computer.tracePath}\``);
        if (report.computer.evidenceDir) lines.push(`- Evidence directory: \`${report.computer.evidenceDir}\``);
        lines.push("");
    }

    if (report.multiAgent?.enabled) {
        lines.push("## Multi-Agent Engineering", "");
        lines.push(`- Roles: Planner (read-only), Implementer (mutation), Debugger (mutation), Reviewer (read-only), Verifier (read-only)`);
        lines.push(`- Handoffs recorded: ${report.multiAgent.handoffs?.length ?? 0}`);
        lines.push(`- Review verdicts: ${report.multiAgent.reviews?.length ?? 0}`);
        lines.push(`- Implementer revision rounds: ${report.multiAgent.revisions?.length ?? 0}/${report.multiAgent.maxReviewRounds ?? 0}`);
        lines.push(`- Verifier gate: ${report.multiAgent.requireVerifierApproval ? "required" : "advisory"}`);
        lines.push(`- Policy violations: ${report.multiAgent.policyViolations?.length ?? 0}`);
        for (const review of report.multiAgent.reviews ?? []) {
            lines.push(`- Reviewer round ${review.round}: **${review.verdict === "approve" ? "APPROVE" : "REQUEST CHANGES"}**${review.summary ? ` — ${review.summary}` : ""}`);
            for (const finding of review.findings ?? []) lines.push(`  - ${finding.severity}: ${finding.path ? `\`${finding.path}\` — ` : ""}${finding.message}`);
        }
        for (const audit of report.multiAgent.verifierAudits ?? []) {
            lines.push(`- Verifier audit ${audit.sequence}: **${audit.verdict === "approve" ? "APPROVE" : "REQUEST CHANGES"}**${audit.summary ? ` — ${audit.summary}` : ""}`);
        }
        if (report.multiAgent.handoffs?.length) {
            lines.push("", "### Handoffs", "");
            for (const handoff of report.multiAgent.handoffs) {
                lines.push(`- ${handoff.sequence}. ${handoff.from} → ${handoff.to}: ${handoff.kind}`);
            }
        }
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
    } else lines.push("No supported coverage artifact was found; coverage is informational in v0.9.");

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
