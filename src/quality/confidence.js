function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function verificationChecks(report) {
    return Array.isArray(report?.verification?.checks) ? report.verification.checks : [];
}

function hasPassingType(report, types) {
    const wanted = new Set(Array.isArray(types) ? types : [types]);
    return verificationChecks(report).some((check) => wanted.has(check.type) && check.status === "passed");
}

function verifierApproved(report) {
    return (report?.multiAgent?.verifierAudits ?? []).some((audit) => audit.verdict === "approve");
}

function labelFor(score) {
    if (score >= 85) return "high";
    if (score >= 65) return "medium";
    return "low";
}

function dedupe(items) {
    return [...new Set(items.filter(Boolean))];
}

export function buildEvidenceConfidence(report) {
    let score = 0;
    const positives = [];
    const deductions = [];
    const gaps = [];

    if (report?.status === "PASS") {
        score += 25;
        positives.push({ points: 25, reason: "Task completed with PASS status." });
    } else if (report?.status === "PLANNED") {
        gaps.push("Task was plan-only; no execution evidence exists.");
    } else {
        deductions.push({ points: -25, reason: "Task did not finish with PASS status." });
    }

    if (report?.verification?.passed === true) {
        score += 25;
        positives.push({ points: 25, reason: "Independent deterministic verification passed." });
    } else if (report?.verification?.passed === null) {
        gaps.push("Verification was not executed.");
    } else {
        deductions.push({ points: -25, reason: "Deterministic verification did not pass." });
    }

    const checks = verificationChecks(report);
    const executed = checks.filter((check) => check.status !== "planned");
    if (executed.length) {
        const passed = executed.filter((check) => check.status === "passed").length;
        const ratio = passed / executed.length;
        const points = Math.round(ratio * 10);
        score += points;
        positives.push({ points, reason: `${passed}/${executed.length} verification checks passed.` });
        if (passed !== executed.length) deductions.push({ points: -10, reason: `${executed.length - passed} verification check(s) failed.` });
    } else {
        gaps.push("No executable verification checks were recorded.");
    }

    const testEvidence = Boolean(report?.testFirst?.red?.validRed) || hasPassingType(report, ["test_gate", "command"]);
    if (report?.testFirst?.red?.validRed) {
        score += 10;
        positives.push({ points: 10, reason: "Test-first RED evidence proved the defect before implementation." });
    } else if (testEvidence) {
        score += 6;
        positives.push({ points: 6, reason: "Automated test/command verification evidence is present." });
    } else {
        gaps.push("No clear automated test evidence was recorded.");
    }

    const diff = report?.verification?.gitDiff;
    if (diff?.available && !diff.incomplete && (diff.unexpectedFiles?.length ?? 0) === 0) {
        score += 10;
        positives.push({ points: 10, reason: "Git change scope is complete with no unexpected files." });
    } else if (diff?.available) {
        const unexpected = diff.unexpectedFiles?.length ?? 0;
        deductions.push({ points: -15, reason: unexpected ? `${unexpected} unexpected changed file(s) were detected.` : "Git change scope was incomplete." });
        score -= 15;
    } else {
        gaps.push("No Git change-scope evidence was available.");
    }

    if (verifierApproved(report)) {
        score += 10;
        positives.push({ points: 10, reason: "Independent read-only Verifier approved the evidence." });
    } else if (report?.multiAgent?.enabled) {
        gaps.push("Multi-agent mode ran without a recorded Verifier approval.");
    } else {
        gaps.push("Independent Verifier role was not used.");
    }

    if (report?.visual?.enabled) {
        if (report.visual.passed) {
            score += 5;
            positives.push({ points: 5, reason: "Visual verification passed." });
        } else {
            score -= 10;
            deductions.push({ points: -10, reason: "Visual verification was enabled but did not pass." });
        }
    }

    if (report?.coverage?.available) {
        score += 5;
        positives.push({ points: 5, reason: "Coverage evidence was collected." });
    } else {
        gaps.push("No supported coverage artifact was collected.");
    }

    const repairs = Number(report?.repairCount ?? 0);
    if (repairs === 0 && report?.status === "PASS") {
        score += 5;
        positives.push({ points: 5, reason: "No repair retries were required." });
    } else if (repairs > 0) {
        const penalty = Math.min(10, repairs * 3);
        score -= penalty;
        deductions.push({ points: -penalty, reason: `${repairs} repair attempt(s) were required.` });
    }

    const finalScore = clamp(score);
    return {
        version: 1,
        score: finalScore,
        label: labelFor(finalScore),
        calibratedProbability: false,
        interpretation: "Deterministic evidence-quality score; it is not a probability that the software is bug-free.",
        positives,
        deductions,
        gaps: dedupe(gaps)
    };
}

export function buildDashboardConfidence(report, {
    signed = false,
    preflight = null,
    changeSet = null,
    checkpoint = null,
    patchReview = null
} = {}) {
    const base = report?.confidence ?? buildEvidenceConfidence(report ?? {});
    let score = Number(base.score ?? 0);
    const positives = [...(base.positives ?? [])];
    const deductions = [...(base.deductions ?? [])];
    const gaps = [...(base.gaps ?? [])];

    if (signed) {
        score += 5;
        positives.push({ points: 5, reason: "The exact JSON report has valid signed provenance." });
    } else {
        score -= 8;
        deductions.push({ points: -8, reason: "Signed report provenance was not verified." });
    }

    if (checkpoint?.rollbackAvailable || (changeSet?.changedFiles?.length ?? 0) === 0) {
        score += 3;
        positives.push({ points: 3, reason: "A finalized rollback checkpoint/change set is available." });
    } else if (changeSet) {
        gaps.push("No rollback checkpoint is currently available for the finalized changes.");
    }

    const risk = String(preflight?.risk?.level ?? "").toLowerCase();
    if (risk === "high") {
        score -= 10;
        deductions.push({ points: -10, reason: "Preflight classified the task as high risk." });
    } else if (risk === "medium") {
        score -= 4;
        deductions.push({ points: -4, reason: "Preflight classified the task as medium risk." });
    }

    const sensitive = Number(patchReview?.summary?.sensitiveFiles ?? 0);
    if (sensitive > 0) {
        const penalty = Math.min(8, sensitive * 2);
        score -= penalty;
        deductions.push({ points: -penalty, reason: `${sensitive} sensitive-path file(s) changed.` });
    }

    const changed = Number(changeSet?.changedFiles?.length ?? 0);
    if (changed > 20) {
        score -= 8;
        deductions.push({ points: -8, reason: `Large change set (${changed} files).` });
    } else if (changed > 8) {
        score -= 4;
        deductions.push({ points: -4, reason: `Moderately large change set (${changed} files).` });
    }

    const finalScore = clamp(score);
    return {
        ...base,
        score: finalScore,
        label: labelFor(finalScore),
        positives,
        deductions,
        gaps: dedupe(gaps),
        dashboardAdjusted: true
    };
}
