import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { enforceRolePolicy } from "../src/agents/policy.js";
import { validateComputerAction } from "../src/computer/policy.js";
import { ComputerSession } from "../src/computer/session.js";
import { ReplayComputerDriver } from "../src/computer/replay.js";
import { CdpComputerDriver } from "../src/computer/cdp.js";
import { executeAction } from "../src/actions/executor.js";
import { ScriptedPlanner } from "../src/planners/scripted.js";
import { runTaskWithRepairs } from "../src/orchestration/repair-loop.js";

async function tempWorkspace() {
    return fs.mkdtemp(path.join(os.tmpdir(), "forgepilot-computer-"));
}

test("read-only agents cannot smuggle computer-control actions", () => {
    const reviewer = enforceRolePolicy("reviewer", {
        verdict: "approve",
        actions: [{ type: "computer_click", selector: "#approve" }]
    });
    assert.equal(reviewer.passed, false);
    const verifier = enforceRolePolicy("verifier", { type: "computer_navigate", url: "http://localhost:3000" });
    assert.equal(verifier.passed, false);
});

test("computer navigation is localhost-only by default and supports explicit origin allowlisting", async () => {
    const workspace = await tempWorkspace();
    assert.doesNotThrow(() => validateComputerAction({ type: "computer_navigate", url: "http://localhost:3000/app" }, workspace));
    assert.throws(() => validateComputerAction({ type: "computer_navigate", url: "https://example.com" }, workspace), /not allowlisted/i);
    assert.doesNotThrow(() => validateComputerAction(
        { type: "computer_navigate", url: "https://example.com/app" },
        workspace,
        { allowedOrigins: ["https://example.com"] }
    ));
});

test("computer session records ordered evidence and redacts typed text by default", async () => {
    const workspace = await tempWorkspace();
    const driver = new ReplayComputerDriver({
        responses: [{ nodes: [{ role: "button", name: "Save" }] }, {}, {}],
        screenshotBytes: Buffer.from("fake-png-evidence")
    });
    const session = new ComputerSession({ driver, workspace, taskId: "trace-redaction" });
    const inspect = await session.execute({ type: "computer_inspect", maxNodes: 5 });
    assert.equal(inspect.status, "passed");
    const typed = await session.execute({ type: "computer_type", selector: "#token", text: "super-secret-token" });
    assert.equal(typed.status, "passed");
    const shot = await session.execute({ type: "computer_screenshot", path: "final.png" });
    assert.equal(shot.status, "passed");
    await session.close();

    const tracePath = path.join(workspace, ".forgepilot", "computer", "trace-redaction", "trace.json");
    const traceText = await fs.readFile(tracePath, "utf8");
    assert.doesNotMatch(traceText, /super-secret-token/);
    const trace = JSON.parse(traceText);
    const typing = trace.trace.find((item) => item.action?.type === "computer_type");
    assert.equal(typing.action.text, "[REDACTED]");
    assert.equal(typing.action.textLength, 18);
    const evidence = path.join(workspace, ".forgepilot", "computer", "trace-redaction", "final.png");
    assert.equal(await fs.readFile(evidence, "utf8"), "fake-png-evidence");
    assert.equal(session.snapshot().actions, 3);
});

test("computer screenshot path cannot escape the evidence directory", async () => {
    const workspace = await tempWorkspace();
    const session = new ComputerSession({ driver: new ReplayComputerDriver(), workspace, taskId: "escape" });
    await assert.rejects(() => session.execute({ type: "computer_screenshot", path: "../../escape.png" }), /escapes workspace|outside|path/i);
    await session.close();
});

test("action executor routes computer actions through the persistent session", async () => {
    const workspace = await tempWorkspace();
    const driver = new ReplayComputerDriver({ responses: [{ clicked: true }] });
    const session = new ComputerSession({ driver, workspace, taskId: "executor" });
    const result = await executeAction({ type: "computer_click", selector: "#run" }, workspace, { apply: true, computerSession: session });
    assert.equal(result.status, "passed");
    assert.equal(driver.actions.length, 1);
    assert.equal(driver.actions[0].selector, "#run");
    await session.close();
});

test("computer failures participate in the bounded repair and retry loop", async () => {
    const workspace = await tempWorkspace();
    const driver = new ReplayComputerDriver({ responses: [{ error: "button not ready" }, {}, { clicked: true }] });
    const session = new ComputerSession({ driver, workspace, taskId: "repair" });
    const task = {
        goal: "Click a UI control and recover once",
        actions: [{ type: "computer_click", selector: "#run" }],
        repairs: [{ rationale: "Wait for UI readiness.", actions: [{ type: "computer_wait", ms: 1 }] }],
        verify: []
    };
    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 1,
        taskId: "computer-repair",
        computerSession: session
    });
    assert.equal(result.repairCount, 1);
    assert.equal(result.verification.passed, true);
    assert.ok(result.actions.some((item) => item.phase === "retry" && item.status === "passed"));
    await session.close();
});

test("CDP driver resolves selectors to coordinates and dispatches mouse input", async () => {
    const calls = [];
    const fakeClient = {
        async connect() { return { id: "page-1", title: "App", url: "http://localhost" }; },
        async send(method, params) {
            calls.push({ method, params });
            if (method === "Runtime.evaluate") return { result: { value: { x: 25, y: 40 } } };
            return {};
        },
        async close() {}
    };
    const driver = new CdpComputerDriver({ client: fakeClient });
    await driver.start();
    const result = await driver.perform({ type: "computer_click", selector: "#save" });
    assert.deepEqual(result, { x: 25, y: 40 });
    assert.equal(calls.filter((item) => item.method === "Input.dispatchMouseEvent").length, 2);
    await driver.stop();
});

test("CDP accessibility inspection is bounded and normalized", async () => {
    const fakeClient = {
        async connect() { return { id: "page-1" }; },
        async send(method) {
            if (method === "Accessibility.getFullAXTree") return {
                nodes: [
                    { nodeId: "1", role: { value: "button" }, name: { value: "Save" }, ignored: false },
                    { nodeId: "2", role: { value: "textbox" }, name: { value: "Name" }, value: { value: "Dan" }, ignored: false }
                ]
            };
            return {};
        },
        async close() {}
    };
    const driver = new CdpComputerDriver({ client: fakeClient });
    await driver.start();
    const result = await driver.perform({ type: "computer_inspect", maxNodes: 1 });
    assert.equal(result.nodes.length, 1);
    assert.deepEqual(result.nodes[0], { nodeId: "1", role: "button", name: "Save", value: null, ignored: false });
    assert.equal(result.truncated, true);
});

test("CDP navigation fails closed when Chromium reports an errorText", async () => {
    const fakeClient = {
        async connect() { return { id: "page-1" }; },
        async send(method) {
            if (method === "Page.navigate") return { frameId: "1", errorText: "net::ERR_BLOCKED_BY_ADMINISTRATOR" };
            return {};
        },
        async close() {}
    };
    const driver = new CdpComputerDriver({ client: fakeClient });
    await driver.start();
    await assert.rejects(() => driver.perform({ type: "computer_navigate", url: "http://localhost" }), /ERR_BLOCKED_BY_ADMINISTRATOR/);
});

test("CDP accessibility assertion turns UI state into a pass/fail gate", async () => {
    const fakeClient = {
        async connect() { return { id: "page-1" }; },
        async send(method) {
            if (method === "Accessibility.getFullAXTree") return {
                nodes: [{ role: { value: "button" }, name: { value: "Save" }, ignored: false }]
            };
            return {};
        },
        async close() {}
    };
    const driver = new CdpComputerDriver({ client: fakeClient });
    await driver.start();
    const passed = await driver.perform({ type: "computer_assert", role: "button", name: "Save" });
    assert.equal(passed.matched, true);
    await assert.rejects(() => driver.perform({ type: "computer_assert", role: "button", name: "Delete" }), /assertion failed/i);
});

test("sandbox evidence exporter accepts computer trace and screenshots", async () => {
    const { createSandboxSession } = await import("../src/sandbox/session.js");
    const original = await tempWorkspace();
    const sandbox = await createSandboxSession(original, { taskId: "computer-evidence" });
    const evidenceDir = path.join(sandbox.workspace, ".forgepilot", "computer", "computer-evidence");
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(path.join(evidenceDir, "trace.json"), "{}", "utf8");
    await fs.writeFile(path.join(evidenceDir, "screen.png"), "png", "utf8");
    const exported = await sandbox.exportEvidence([
        ".forgepilot/computer/computer-evidence/trace.json",
        ".forgepilot/computer/computer-evidence/screen.png"
    ]);
    assert.equal(exported.length, 2);
    assert.equal(await fs.readFile(path.join(original, ".forgepilot", "computer", "computer-evidence", "trace.json"), "utf8"), "{}");
    await sandbox.close();
});

test("CDP session refuses to inspect an already-open external target unless its origin is allowlisted", async () => {
    const workspace = await tempWorkspace();
    const driver = {
        async start() { return { url: "https://example.com" }; },
        async currentUrl() { return "https://example.com/private"; },
        async perform() { return { nodes: [] }; },
        async stop() {},
        describe() { return { kind: "fake-cdp" }; }
    };
    const session = new ComputerSession({ driver, workspace, taskId: "current-origin" });
    await assert.rejects(() => session.execute({ type: "computer_inspect" }), /not allowlisted/i);
    await session.close();
});
