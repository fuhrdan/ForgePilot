import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { buildEvidenceConfidence, buildDashboardConfidence } from "../src/quality/confidence.js";
import { createWorkspaceCheckpoint, finalizeWorkspaceCheckpoint } from "../src/repository/checkpoint.js";
import { buildPatchReview, sensitivityForPath } from "../src/repository/patch-review.js";
import { DashboardJobManager } from "../src/dashboard/jobs.js";
import { signReport } from "../src/security/provenance.js";

async function tempDir(prefix = "fp015-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

function strongReport(overrides = {}) {
    return {
        version: "0.15.0",
        status: "PASS",
        repairCount: 0,
        verification: {
            passed: true,
            checks: [
                { type: "test_gate", status: "passed" },
                { type: "git_scope", status: "passed" }
            ],
            gitDiff: { available: true, incomplete: false, unexpectedFiles: [], changedFiles: [{ path: "src/app.js" }] }
        },
        testFirst: { red: { validRed: true } },
        multiAgent: { enabled: true, verifierAudits: [{ verdict: "approve" }] },
        visual: { enabled: true, passed: true },
        coverage: { available: true },
        ...overrides
    };
}

async function waitFor(manager, id, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const job = manager.get(id);
        if (["pass", "fail", "cancelled"].includes(job?.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for v0.15 dashboard job.");
}

test("strong deterministic evidence reaches high confidence without claiming probability", () => {
    const result = buildEvidenceConfidence(strongReport());
    assert.equal(result.score, 100);
    assert.equal(result.label, "high");
    assert.equal(result.calibratedProbability, false);
    assert.match(result.interpretation, /not a probability/i);
});

test("passing status alone remains low confidence when evidence is thin", () => {
    const result = buildEvidenceConfidence({ status: "PASS", repairCount: 0, verification: { passed: true, checks: [], gitDiff: { available: false } }, coverage: { available: false }, multiAgent: { enabled: false } });
    assert.equal(result.label, "low");
    assert.ok(result.score < 65);
    assert.ok(result.gaps.some((gap) => /test evidence/i.test(gap)));
    assert.ok(result.gaps.some((gap) => /Git change-scope/i.test(gap)));
});

test("repair attempts reduce evidence confidence deterministically", () => {
    const clean = buildEvidenceConfidence(strongReport({ visual: { enabled: false }, coverage: { available: false } }));
    const repaired = buildEvidenceConfidence(strongReport({ repairCount: 3, visual: { enabled: false }, coverage: { available: false } }));
    assert.ok(repaired.score < clean.score);
    assert.ok(repaired.deductions.some((item) => /3 repair attempt/.test(item.reason)));
});

test("dashboard confidence conservatively accounts for risk, sensitive paths, and provenance", () => {
    const report = strongReport({ confidence: buildEvidenceConfidence(strongReport()) });
    const result = buildDashboardConfidence(report, {
        signed: true,
        preflight: { risk: { level: "high" } },
        changeSet: { changedFiles: [{ path: "src/auth/session.js" }] },
        checkpoint: { rollbackAvailable: true },
        patchReview: { summary: { sensitiveFiles: 1 } }
    });
    assert.equal(result.dashboardAdjusted, true);
    assert.ok(result.score < 100);
    assert.ok(result.deductions.some((item) => /high risk/.test(item.reason)));
    assert.ok(result.deductions.some((item) => /sensitive-path/.test(item.reason)));
    assert.ok(result.positives.some((item) => /signed provenance/.test(item.reason)));
});

test("patch review summarizes added, modified, deleted and line deltas without source contents", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "app.txt"), "alpha\nbeta\ngamma\n");
    await fs.writeFile(path.join(workspace, "remove.txt"), "remove me\n");
    await createWorkspaceCheckpoint(workspace, "review");
    await fs.writeFile(path.join(workspace, "app.txt"), "alpha\nBETA\ngamma\ndelta\n");
    await fs.writeFile(path.join(workspace, "new.txt"), "one\ntwo\n");
    await fs.rm(path.join(workspace, "remove.txt"));
    await finalizeWorkspaceCheckpoint(workspace, "review");
    const review = await buildPatchReview(workspace, "review");
    assert.deepEqual([review.summary.addedFiles, review.summary.modifiedFiles, review.summary.deletedFiles], [1, 1, 1]);
    assert.ok(review.summary.estimatedModifiedLines >= 1);
    assert.ok(review.summary.estimatedAddedLines >= 1);
    const serialized = JSON.stringify(review);
    assert.equal(serialized.includes("BETA"), false);
    assert.equal(serialized.includes("remove me"), false);
    assert.match(review.privacy, /No source file contents/);
});

test("patch review marks binary and oversized files without reading them as text", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "asset.bin"), Buffer.from([0, 1, 2, 3]));
    await createWorkspaceCheckpoint(workspace, "binary");
    await fs.writeFile(path.join(workspace, "asset.bin"), Buffer.from([0, 9, 8, 7, 6]));
    await finalizeWorkspaceCheckpoint(workspace, "binary");
    const review = await buildPatchReview(workspace, "binary", { maxTextBytes: 2 });
    assert.equal(review.files[0].binary, true);
    assert.equal(review.files[0].oversized, true);
    assert.equal(review.files[0].lines, null);
});

test("sensitive-path classification is deterministic and conservative", () => {
    assert.equal(sensitivityForPath("src/auth/session.js"), "high");
    assert.equal(sensitivityForPath("migrations/014.sql"), "high");
    assert.equal(sensitivityForPath("package.json"), "medium");
    assert.equal(sensitivityForPath("docs/README.md"), "low");
    assert.equal(sensitivityForPath("src/math.js"), "normal");
});

test("dashboard finalization publishes patch review and confidence only after a signed report and checkpoint finalize", async () => {
    const workspace = await tempDir();
    await fs.writeFile(path.join(workspace, "app.txt"), "before\n");
    const spawner = (_command, _args, options) => {
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => true;
        setTimeout(async () => {
            try {
                await fs.writeFile(path.join(options.cwd, "app.txt"), "after\n");
                const runDir = path.join(options.cwd, ".forgepilot", "runs", "acceptance");
                await fs.mkdir(runDir, { recursive: true });
                const reportPath = path.join(runDir, "report.json");
                const report = strongReport();
                report.confidence = buildEvidenceConfidence(report);
                await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
                await signReport(options.cwd, reportPath);
                child.stdout.write(`Result: PASS\nJSON:   ${reportPath}\nReport: ${path.join(runDir, "report.md")}\n`);
            } catch (error) {
                child.stderr.write(error.message + "\n");
            }
            child.stdout.end(); child.stderr.end(); child.emit("close", 0);
        }, 10);
        return child;
    };
    const manager = new DashboardJobManager({ spawner });
    const created = await manager.create({ workspace, goal: "Update app" });
    const done = await waitFor(manager, created.id);
    assert.equal(done.status, "pass");
    assert.equal(done.signed, true);
    assert.equal(done.patchReview.summary.modifiedFiles, 1);
    assert.ok(done.confidence.score >= 85);
    assert.equal(done.confidence.dashboardAdjusted, true);
});
