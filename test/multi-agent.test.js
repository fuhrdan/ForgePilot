import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { AgentTeam } from "../src/agents/team.js";
import { enforceRolePolicy } from "../src/agents/policy.js";
import { ScriptedPlanner } from "../src/planners/scripted.js";
import { OllamaPlanner } from "../src/planners/ollama.js";
import { runTaskWithRepairs } from "../src/orchestration/repair-loop.js";

async function tempWorkspace() {
    return fs.mkdtemp(path.join(os.tmpdir(), "forgepilot-agents-"));
}

function scriptedTeam(task, options = {}) {
    return new AgentTeam({
        adapter: new ScriptedPlanner(),
        enabled: true,
        maxReviewRounds: options.maxReviewRounds ?? task.agentTeam?.maxReviewRounds ?? 2,
        requireVerifierApproval: options.requireVerifierApproval ?? task.agentTeam?.requireVerifierApproval ?? true
    });
}

test("read-only agent roles reject mutation payloads", () => {
    const reviewer = enforceRolePolicy("reviewer", {
        verdict: "approve",
        actions: [{ type: "write_file", path: "oops.txt", content: "bad" }]
    });
    assert.equal(reviewer.passed, false);
    assert.match(reviewer.violations[0].message, /read_only|read-only|attempted/i);

    const verifier = enforceRolePolicy("verifier", { commands: [{ command: "node", args: ["x.js"] }] });
    assert.equal(verifier.passed, false);

    const implementer = enforceRolePolicy("implementer", { actions: [{ type: "write_file", path: "ok.txt", content: "ok" }] });
    assert.equal(implementer.passed, true);
});

test("agent team records Planner to Implementer structured handoff", async () => {
    const task = {
        goal: "Create a result",
        rationale: "Use a tiny text artifact.",
        actions: [{ type: "write_file", path: "result.txt", content: "ready" }],
        verify: [{ type: "file_contains", path: "result.txt", text: "ready" }]
    };
    const team = scriptedTeam(task);
    const plan = await team.prepare(task, { files: [], git: { isRepository: false }, repository: null });
    assert.equal(plan.actions.length, 1);
    const snapshot = team.snapshot();
    assert.equal(snapshot.handoffs.length, 2);
    assert.equal(snapshot.handoffs[0].from, "planner");
    assert.equal(snapshot.handoffs[0].to, "implementer");
    assert.equal(snapshot.handoffs[1].from, "implementer");
    assert.equal(snapshot.handoffs[1].to, "orchestrator");
    assert.equal(snapshot.policyViolations.length, 0);
});

test("reviewer can request changes and Implementer revision is re-reviewed before verification", async () => {
    const workspace = await tempWorkspace();
    const task = {
        goal: "Produce a reviewed artifact",
        actions: [{ type: "write_file", path: "result.txt", content: "draft" }],
        verify: [{ type: "file_contains", path: "result.txt", text: "reviewed" }],
        agentTeam: {
            enabled: true,
            maxReviewRounds: 2,
            reviews: [
                { verdict: "request_changes", summary: "Artifact is still a draft.", findings: [{ severity: "error", path: "result.txt", message: "Replace draft marker with reviewed marker." }] },
                { verdict: "approve", summary: "Requested change is present.", findings: [] }
            ],
            revisions: [
                { rationale: "Apply the review finding.", actions: [{ type: "replace_text", path: "result.txt", find: "draft", replace: "reviewed", expectedOccurrences: 1 }] }
            ],
            verifierAudits: [{ verdict: "approve", summary: "Deterministic evidence is sufficient.", findings: [] }]
        }
    };
    const planner = new ScriptedPlanner();
    const result = await runTaskWithRepairs({
        task,
        planner,
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId: "agent-review",
        agentTeam: scriptedTeam(task)
    });

    assert.equal(result.verification.passed, true);
    assert.equal(await fs.readFile(path.join(workspace, "result.txt"), "utf8"), "reviewed");
    assert.equal(result.multiAgent.reviews.length, 2);
    assert.equal(result.multiAgent.revisions.length, 1);
    assert.equal(result.multiAgent.verifierAudits.length, 1);
    assert.ok(result.actions.some((item) => item.phase === "review-revision"));
});

test("Reviewer cannot smuggle executable mutations into a verdict", async () => {
    const workspace = await tempWorkspace();
    const task = {
        goal: "Protect review separation",
        actions: [{ type: "write_file", path: "result.txt", content: "safe" }],
        verify: [{ type: "file_contains", path: "result.txt", text: "safe" }],
        agentTeam: {
            enabled: true,
            reviews: [{
                verdict: "approve",
                summary: "Attempt hidden edit.",
                findings: [],
                actions: [{ type: "write_file", path: "hacked.txt", content: "should-not-run" }]
            }]
        }
    };

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 0,
        taskId: "review-policy",
        agentTeam: scriptedTeam(task)
    });

    assert.equal(result.verification.passed, false);
    assert.match(result.verification.skipped, /read-only role policy/);
    assert.ok(result.multiAgent.policyViolations.length >= 1);
    await assert.rejects(fs.stat(path.join(workspace, "hacked.txt")));
    assert.equal(await fs.readFile(path.join(workspace, "result.txt"), "utf8"), "safe");
});

test("Verifier rejection can trigger Debugger repair and independent re-audit", async () => {
    const workspace = await tempWorkspace();
    const task = {
        goal: "Satisfy independent verification",
        actions: [{ type: "write_file", path: "result.txt", content: "ok" }],
        verify: [{ type: "file_exists", path: "result.txt" }],
        repairs: [{
            rationale: "Address verifier evidence.",
            actions: [{ type: "replace_text", path: "result.txt", find: "ok", replace: "verified", expectedOccurrences: 1 }]
        }],
        agentTeam: {
            enabled: true,
            reviews: [{ verdict: "approve", summary: "Implementation is reviewable.", findings: [] }],
            verifierAudits: [
                { verdict: "request_changes", summary: "Evidence artifact needs explicit verified marker.", findings: [{ severity: "error", path: "result.txt", message: "Missing verified marker." }] },
                { verdict: "approve", summary: "Verified marker is now present.", findings: [] }
            ]
        }
    };

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 1,
        taskId: "verifier-repair",
        agentTeam: scriptedTeam(task)
    });

    assert.equal(result.verification.passed, true);
    assert.equal(result.repairCount, 1);
    assert.equal(result.multiAgent.verifierAudits.length, 2);
    assert.equal(result.multiAgent.verifierAudits[0].verdict, "request_changes");
    assert.equal(result.multiAgent.verifierAudits[1].verdict, "approve");
    assert.equal(await fs.readFile(path.join(workspace, "result.txt"), "utf8"), "verified");
    assert.ok(result.multiAgent.handoffs.some((item) => item.from === "debugger"));
});

test("review change-request rounds are bounded independently from repair attempts", async () => {
    const workspace = await tempWorkspace();
    const task = {
        goal: "Bound review churn",
        actions: [{ type: "write_file", path: "result.txt", content: "v0" }],
        verify: [{ type: "file_exists", path: "result.txt" }],
        agentTeam: {
            enabled: true,
            maxReviewRounds: 1,
            reviews: [
                { verdict: "request_changes", summary: "First change.", findings: [{ severity: "warning", path: "result.txt", message: "Use v1." }] },
                { verdict: "request_changes", summary: "Second change.", findings: [{ severity: "warning", path: "result.txt", message: "Use v2." }] }
            ],
            revisions: [{ actions: [{ type: "replace_text", path: "result.txt", find: "v0", replace: "v1", expectedOccurrences: 1 }] }]
        }
    };

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 5,
        taskId: "review-budget",
        agentTeam: scriptedTeam(task, { maxReviewRounds: 1 })
    });

    assert.equal(result.verification.passed, false);
    assert.match(result.verification.skipped, /review change-request budget exhausted/);
    assert.equal(result.repairCount, 0);
    assert.equal(result.multiAgent.reviews.length, 2);
    assert.equal(await fs.readFile(path.join(workspace, "result.txt"), "utf8"), "v1");
});


test("Verifier mutation-policy violation fails closed without consuming Debugger repair budget", async () => {
    const workspace = await tempWorkspace();
    const task = {
        goal: "Protect verifier separation",
        actions: [{ type: "write_file", path: "result.txt", content: "safe" }],
        verify: [{ type: "file_contains", path: "result.txt", text: "safe" }],
        repairs: [{ actions: [{ type: "write_file", path: "should-not-repair.txt", content: "bad" }] }],
        agentTeam: {
            enabled: true,
            reviews: [{ verdict: "approve", summary: "Review passed.", findings: [] }],
            verifierAudits: [{
                verdict: "approve",
                summary: "Attempt hidden command.",
                findings: [],
                command: "node"
            }]
        }
    };

    const result = await runTaskWithRepairs({
        task,
        planner: new ScriptedPlanner(),
        plannerName: "scripted",
        workspace,
        apply: true,
        maxRepairs: 3,
        taskId: "verifier-policy",
        agentTeam: scriptedTeam(task)
    });

    assert.equal(result.verification.passed, false);
    assert.equal(result.repairCount, 0);
    assert.ok(result.multiAgent.policyViolations.length >= 1);
    assert.equal(result.verification.checks.at(-1).type, "agent_verifier");
    assert.equal(result.verification.checks.at(-1).policyPassed, false);
    await assert.rejects(fs.stat(path.join(workspace, "should-not-repair.txt")));
});

test("Ollama multi-agent role methods parse structured strategy, implementation, review, and audit", async () => {
    const responses = [
        { goal: "g", approach: "a", risks: [], acceptanceCriteria: ["done"] },
        { goal: "g", rationale: "r", actions: [], verify: [] },
        { verdict: "approve", summary: "looks good", findings: [] },
        { verdict: "approve", summary: "evidence good", findings: [] }
    ];
    const prompts = [];
    const server = http.createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        prompts.push(JSON.parse(body).prompt);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ response: JSON.stringify(responses.shift()) }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const adapter = new OllamaPlanner({ model: "test", baseUrl: `http://127.0.0.1:${address.port}` });
    const context = { files: [], git: { isRepository: false, branch: null }, repository: null };
    const strategy = await adapter.strategy({ goal: "g" }, context);
    const implementation = await adapter.implement({ goal: "g" }, context, strategy);
    const review = await adapter.review({ goal: "g" }, context, {}, 1);
    const audit = await adapter.audit({ goal: "g" }, context, { deterministicPassed: true });
    assert.equal(strategy.approach, "a");
    assert.deepEqual(implementation.actions, []);
    assert.equal(review.verdict, "approve");
    assert.equal(audit.verdict, "approve");
    assert.match(prompts[0], /PLANNER/);
    assert.match(prompts[1], /IMPLEMENTER/);
    assert.match(prompts[2], /REVIEWER/);
    assert.match(prompts[3], /VERIFIER/);
    await new Promise((resolve) => server.close(resolve));
});
