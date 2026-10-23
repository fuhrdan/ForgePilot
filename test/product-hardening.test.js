import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SecretStore } from "../src/security/secrets.js";
import { ApprovalManager } from "../src/security/approvals.js";
import { executeAction } from "../src/actions/executor.js";
import { signReport, verifyReportProvenance } from "../src/security/provenance.js";
import { detectHardware, recommendProfile, resolveProfile } from "../src/product/profiles.js";
import { RecoveryJournal, listRecoveryJournals } from "../src/product/recovery.js";
import { createDashboardServer } from "../src/dashboard/server.js";
import { WindowsUiComputerDriver } from "../src/computer/windows-ui.js";
import { ScriptedPlanner } from "../src/planners/scripted.js";
import { runTaskWithRepairs } from "../src/orchestration/repair-loop.js";

async function tempDir(prefix = "fp09-") { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

test("environment-backed secrets resolve transiently and redact known values", () => {
    const store = new SecretStore({ token: { env: "FP_TEST_TOKEN" } }, { env: { FP_TEST_TOKEN: "super-secret-value" } });
    assert.equal(store.resolveValue("Bearer ${{ secret.token }}"), "Bearer super-secret-value");
    assert.equal(store.redactText("x super-secret-value y"), "x [REDACTED_SECRET] y");
    assert.deepEqual(store.summary(), [{ alias: "token", env: "FP_TEST_TOKEN", available: true }]);
});

test("secret-backed command execution never returns the resolved secret", async () => {
    const workspace = await tempDir();
    const store = new SecretStore({ token: "FP_TEST_TOKEN" }, { env: { FP_TEST_TOKEN: "do-not-persist" } });
    const result = await executeAction({
        type: "run_command",
        command: "node",
        args: ["-e", "console.log(process.env.TOKEN)"],
        env: { TOKEN: { secretRef: "token" } }
    }, workspace, { apply: true, secretStore: store });
    assert.equal(result.status, "passed");
    assert.match(result.stdout, /\[REDACTED_SECRET\]/);
    assert.doesNotMatch(JSON.stringify(result), /do-not-persist/);
});

test("required approval categories fail closed until explicitly granted", () => {
    const denied = new ApprovalManager({ require: ["command_exec"] });
    assert.throws(() => denied.checkAction({ type: "run_command", command: "node" }), /Approval required/);
    const allowed = new ApprovalManager({ require: ["command_exec"] }, { grants: ["command_exec"] });
    assert.doesNotThrow(() => allowed.checkAction({ type: "run_command", command: "node" }));
    assert.equal(allowed.snapshot().decisions.at(-1).granted, true);
});

test("Ed25519 provenance verifies an unchanged report and detects tampering", async () => {
    const workspace = await tempDir();
    const runDir = path.join(workspace, ".forgepilot", "runs", "test-run");
    await fs.mkdir(runDir, { recursive: true });
    const reportPath = path.join(runDir, "report.json");
    await fs.writeFile(reportPath, JSON.stringify({ status: "PASS", version: "0.9.0" }) + "\n");
    const signed = await signReport(workspace, reportPath);
    const verified = await verifyReportProvenance(reportPath, { trustedPublicKeyPath: signed.publicPath });
    assert.equal(verified.passed, true);
    assert.equal(verified.trustedKeyMatch, true);
    await fs.appendFile(reportPath, "tampered\n");
    const tampered = await verifyReportProvenance(reportPath, { trustedPublicKeyPath: signed.publicPath });
    assert.equal(tampered.passed, false);
    assert.equal(tampered.hashValid, false);
});

test("hardware profiles choose conservative, balanced, and high-memory defaults", () => {
    const low = detectHardware({ totalmem: 8 * 1024 ** 3, cpus: Array(4).fill({}), platform: "win32", arch: "x64" });
    const mid = detectHardware({ totalmem: 32 * 1024 ** 3, cpus: Array(12).fill({}), platform: "win32", arch: "x64" });
    const high = detectHardware({ totalmem: 96 * 1024 ** 3, cpus: Array(24).fill({}), platform: "win32", arch: "x64" });
    assert.equal(recommendProfile(low), "low-resource");
    assert.equal(recommendProfile(mid), "balanced");
    assert.equal(recommendProfile(high), "high-quality");
    assert.equal(resolveProfile("auto", low).name, "low-resource");
});

test("recovery journal records completion and reports stale interrupted runs", async () => {
    const workspace = await tempDir();
    const journal = new RecoveryJournal(workspace, "task-a");
    await journal.begin({ goal: "demo" });
    await journal.checkpoint("execution", { actionIndex: 2 });
    await journal.complete("PASS", { reportPath: "report.json" });
    const recoveryDir = path.join(workspace, ".forgepilot", "recovery");
    await fs.writeFile(path.join(recoveryDir, "task-stale.json"), JSON.stringify({ taskId: "task-stale", status: "running", pid: 2147483647, phase: "execution", updatedAt: "2026-10-23T00:00:00Z" }));
    const records = await listRecoveryJournals(workspace);
    assert.equal(records.find((item) => item.taskId === "task-a").status, "pass");
    assert.equal(records.find((item) => item.taskId === "task-stale").stale, true);
});

test("local dashboard exposes signed run history on loopback", async () => {
    const workspace = await tempDir();
    const runDir = path.join(workspace, ".forgepilot", "runs", "2026-test");
    await fs.mkdir(runDir, { recursive: true });
    const reportPath = path.join(runDir, "report.json");
    await fs.writeFile(reportPath, JSON.stringify({ createdAt: "2026-10-23T00:00:00Z", taskId: "x", goal: "dashboard", status: "PASS", version: "0.9.0" }) + "\n");
    await signReport(workspace, reportPath);
    const dashboard = await createDashboardServer({ workspace, port: 0 });
    try {
        const response = await fetch(`http://${dashboard.host}:${dashboard.port}/api/runs`);
        assert.equal(response.status, 200);
        const runs = await response.json();
        assert.equal(runs[0].goal, "dashboard");
        assert.equal(runs[0].signed, true);
    } finally {
        await new Promise((resolve) => dashboard.server.close(resolve));
    }
});

test("native Windows UI driver fails closed on non-Windows hosts", async () => {
    const driver = new WindowsUiComputerDriver({ platform: "linux" });
    await assert.rejects(driver.start(), /only available on Windows/);
});

test("native Windows UI bridge passes action payload through environment rather than command text", async () => {
    let captured = null;
    const driver = new WindowsUiComputerDriver({
        platform: "win32",
        runner: async (command, args, options) => {
            captured = { command, args, options };
            return JSON.stringify({ matched: true, name: "Save" });
        }
    });
    await driver.start();
    const result = await driver.perform({ type: "computer_assert", selector: "saveButton", contains: "Save" });
    assert.equal(result.matched, true);
    assert.equal(captured.command, "powershell.exe");
    assert.equal(captured.args.includes("saveButton"), false);
    assert.match(captured.options.env.FORGEPILOT_UI_PAYLOAD, /saveButton/);
});


test("verification approval denial fails closed without spending repair budget", async () => {
    const workspace = await tempDir();
    const task = {
        goal: "approval verification",
        actions: [{ type: "write_file", path: "app.js", content: "console.log('ok');\n" }],
        verify: [{ type: "command", command: "node", args: ["app.js"], stdoutIncludes: "ok" }]
    };
    const approvals = new ApprovalManager({ require: ["command_exec"] });
    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 2,
        taskId: "approval-verification",
        approvalManager: approvals
    });
    assert.equal(result.verification.passed, false);
    assert.equal(result.repairCount, 0);
    assert.equal(result.verification.checks.find((check) => check.status === "failed").code, "APPROVAL_REQUIRED");
});
