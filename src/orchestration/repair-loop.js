import { executeAction, executePlan } from "../actions/executor.js";
import { verifyPlan } from "../verification/verifier.js";
import { getGitStatus } from "../core/workspace.js";
import { saveState } from "../core/state.js";
import { buildRepositoryContext } from "../repository/context.js";
import { captureGitBaseline, summarizeGitDiff } from "../repository/git-diff.js";
import { collectCoverage } from "../testing/coverage.js";
import {
    captureVisualBaselineSnapshot,
    normalizeVisual,
    verifyVisualPlan,
    visualBaselinePaths
} from "../visual/workflow.js";
import { discoverTesting } from "../testing/discovery.js";
import {
    actionTouchesProtectedTest,
    appendEngineeringGates,
    captureProtectedTestSnapshot,
    executeTestAuthoring,
    normalizeTestFirst,
    protectedTestPaths,
    runRedGate,
    verifyProtectedTestSnapshot,
    verifyTestOnlyDiff
} from "../testing/workflow.js";

function failedChecks(verification) {
    return verification.checks.filter((check) => check.status === "failed");
}

async function contextFor(workspace, task) {
    const repository = await buildRepositoryContext(workspace, {
        goal: task.goal ?? "",
        maxContextTokens: Number(task.maxContextTokens ?? 6000)
    });
    return {
        workspace,
        git: await getGitStatus(workspace),
        files: repository.files,
        repository
    };
}

async function executeRepairActions(repairPlan, workspace, apply, protectedPaths = [], executionProvider = null, computerSession = null) {
    const results = [];
    for (let index = 0; index < repairPlan.actions.length; index++) {
        const action = repairPlan.actions[index];
        if (actionTouchesProtectedTest(action, protectedPaths)) {
            results.push({
                index,
                type: action.type,
                status: "failed",
                path: action.path,
                error: "Repair attempted to modify a protected RED-proven test or visual baseline. Protected evidence is immutable during implementation."
            });
            break;
        }
        const result = await executeAction(action, workspace, { apply, index, executionProvider, computerSession });
        results.push(result);
        if (result.status === "failed") break;
    }
    return results;
}

function verificationOptions(task, gitBaseline, executionProvider = null) {
    return {
        apply: true,
        gitBaseline,
        expectedChangePaths: Array.isArray(task.expectedChangePaths) ? task.expectedChangePaths : [],
        enforceGitScope: task.enforceGitScope === true,
        executionProvider
    };
}

async function verifyWithEvidence(plan, workspace, task, gitBaseline, testSnapshot, visual, visualBaselineSnapshot, executionProvider = null, visionProvider = null, taskId = "task", agentTeam = null) {
    const verification = await verifyPlan(plan, workspace, verificationOptions(task, gitBaseline, executionProvider));
    if (testSnapshot) {
        const integrity = await verifyProtectedTestSnapshot(workspace, testSnapshot);
        verification.checks.push({
            index: verification.checks.length,
            type: "test_integrity",
            phase: "integrity",
            status: integrity.passed ? "passed" : "failed",
            changedTestFiles: integrity.changed
        });
        verification.passed = verification.passed && integrity.passed;
    }

    const visualEvidence = await verifyVisualPlan(visual, workspace, {
        apply: true, executionProvider, visionProvider, taskId, baselineSnapshot: visualBaselineSnapshot
    });
    for (const check of visualEvidence.checks) {
        verification.checks.push({ ...check, index: verification.checks.length, phase: "visual" });
    }
    verification.passed = verification.passed && visualEvidence.passed;
    verification.visual = visualEvidence;

    if (agentTeam?.enabled) {
        const auditEvidence = {
            deterministicPassed: verification.passed,
            checks: verification.checks.map((check) => ({
                type: check.type,
                phase: check.phase ?? null,
                status: check.status,
                error: check.error ?? null
            })),
            gitDiff: verification.gitDiff ? {
                available: verification.gitDiff.available,
                changedFiles: verification.gitDiff.changedFiles?.map((item) => ({ path: item.path, status: item.status })) ?? [],
                unexpectedFiles: verification.gitDiff.unexpectedFiles?.map((item) => ({ path: item.path, status: item.status })) ?? []
            } : null
        };
        const audit = await agentTeam.audit(task, await contextFor(workspace, task), auditEvidence);
        const auditPassed = audit.verdict === "approve" || !agentTeam.requireVerifierApproval;
        verification.checks.push({
            index: verification.checks.length,
            type: "agent_verifier",
            phase: "agent-verifier",
            status: auditPassed ? "passed" : "failed",
            verdict: audit.verdict,
            summary: audit.summary,
            findings: audit.findings,
            advisory: !agentTeam.requireVerifierApproval,
            policyPassed: audit.policyPassed
        });
        verification.passed = verification.passed && auditPassed;
        verification.agentVerifier = audit;
    }
    return verification;
}

async function earlyFailure({ workspace, gitBaseline, task, reason, checks = [], testFirst = null }) {
    return {
        passed: false,
        checks,
        git: await getGitStatus(workspace),
        gitDiff: await summarizeGitDiff(workspace, gitBaseline, task.expectedChangePaths ?? []),
        skipped: reason,
        testFirst
    };
}

export async function runTaskWithRepairs({
    task,
    planner,
    plannerName,
    workspace,
    apply = false,
    maxRepairs = 2,
    taskId,
    resumeState = null,
    executionProvider = null,
    visionProvider = null,
    agentTeam = null,
    computerSession = null
}) {
    const initialContext = await contextFor(workspace, task);
    if (agentTeam?.enabled && resumeState?.multiAgent) agentTeam.restore(resumeState.multiAgent);
    const planned = resumeState?.plan ?? (agentTeam?.enabled
        ? await agentTeam.prepare(task, initialContext)
        : await planner.plan(task, initialContext));
    const intendedSourcePaths = (planned.actions ?? [])
        .filter((action) => ["write_file", "replace_text"].includes(action.type) && action.path)
        .map((action) => action.path);
    initialContext.repository.testing = await discoverTesting(
        workspace,
        initialContext.repository.files,
        initialContext.repository.projects,
        initialContext.repository.commandHints,
        { goal: task.goal ?? "", sourcePaths: intendedSourcePaths }
    );
    const testFirst = normalizeTestFirst(planned, initialContext.repository, task);
    const visual = normalizeVisual(planned, task);
    const plan = testFirst ? appendEngineeringGates(planned, testFirst) : planned;
    const gitBaseline = resumeState?.gitBaseline ?? await captureGitBaseline(workspace);
    const visualBaselineSnapshot = resumeState?.visualBaselineSnapshot ?? await captureVisualBaselineSnapshot(visual, workspace);

    if (!apply) {
        const testAuthoring = testFirst ? await executeTestAuthoring(testFirst, workspace, { apply: false, executionProvider }) : [];
        const actions = await executePlan(plan, workspace, { apply: false, executionProvider, computerSession });
        const verification = await verifyPlan(plan, workspace, {
            apply: false,
            gitBaseline,
            expectedChangePaths: task.expectedChangePaths ?? [],
            executionProvider
        });
        const visualEvidence = await verifyVisualPlan(visual, workspace, { apply: false, taskId, baselineSnapshot: visualBaselineSnapshot });
        for (const check of visualEvidence.checks) verification.checks.push({ ...check, index: verification.checks.length, phase: "visual" });
        verification.visual = visualEvidence;
        return {
            plan, actions, verification, repairs: [], repairCount: 0, resumed: false,
            repository: initialContext.repository,
            testFirst: testFirst ? { enabled: true, authoring: testAuthoring, red: null, testOnlyDiff: null } : null,
            visual: visualEvidence,
            coverage: { available: false },
            multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : null
        };
    }

    let state = resumeState ?? {
        version: 6,
        taskId,
        planner: plannerName,
        plan,
        gitBaseline,
        actionIndex: 0,
        actions: [],
        repairs: [],
        repairCount: 0,
        status: "running",
        createdAt: new Date().toISOString(),
        lastFailure: null,
        testFirst: null,
        testSnapshot: null,
        visualBaselineSnapshot,
        multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : null
    };

    state.status = "running";
    state.plan = plan;
    state.gitBaseline = gitBaseline;
    state.visualBaselineSnapshot = visualBaselineSnapshot;
    state.multiAgent = agentTeam?.enabled ? agentTeam.snapshot() : null;
    state = await saveState(workspace, state);

    let testFirstEvidence = state.testFirst ?? null;
    let testSnapshot = state.testSnapshot ?? null;
    const protectedTestFiles = testFirst ? protectedTestPaths(testFirst) : [];
    const protectedVisualBaselines = visualBaselinePaths(visual);
    let protectedPaths = [...new Set([...protectedTestFiles, ...protectedVisualBaselines])];

    if (testFirst && !testFirstEvidence?.red?.validRed) {
        const authoring = await executeTestAuthoring(testFirst, workspace, { apply: true, executionProvider });
        if (authoring.some((item) => item.status === "failed")) {
            const verification = await earlyFailure({
                workspace, gitBaseline, task,
                reason: "test authoring failed before RED gate",
                checks: authoring.map((item, index) => ({ index, type: "test_authoring", phase: "author", status: item.status, ...item }))
            });
            testFirstEvidence = { enabled: true, authoring, testOnlyDiff: null, red: null };
            state = await saveState(workspace, { ...state, status: "failed", testFirst: testFirstEvidence, multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : state.multiAgent ?? null, lastFailure: { kind: "test_authoring", authoring } });
            return { plan, actions: [], verification, repairs: [], repairCount: 0, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, coverage: { available: false } };
        }

        const testOnlyDiff = await verifyTestOnlyDiff(workspace, gitBaseline, testFirst);
        if (!testOnlyDiff.passed) {
            const verification = await earlyFailure({
                workspace, gitBaseline, task,
                reason: "test-first policy rejected non-test or missing test changes",
                checks: [{ index: 0, type: "test_change_policy", phase: "author", status: "failed", ...testOnlyDiff }]
            });
            testFirstEvidence = { enabled: true, authoring, testOnlyDiff, red: null };
            state = await saveState(workspace, { ...state, status: "failed", testFirst: testFirstEvidence, multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : state.multiAgent ?? null, lastFailure: { kind: "test_change_policy", testOnlyDiff } });
            return { plan, actions: [], verification, repairs: [], repairCount: 0, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, coverage: { available: false } };
        }

        const red = await runRedGate(workspace, testFirst.red, executionProvider);
        testFirstEvidence = { enabled: true, authoring, testOnlyDiff, red, selectedTests: testFirst.selectedTests };
        if (!red.validRed) {
            const verification = await earlyFailure({
                workspace, gitBaseline, task,
                reason: red.reason,
                checks: [{ index: 0, type: "test_gate", phase: "red", status: "failed", ...red }],
                testFirst: testFirstEvidence
            });
            state = await saveState(workspace, { ...state, status: "failed", testFirst: testFirstEvidence, multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : state.multiAgent ?? null, lastFailure: { kind: "red_gate", red } });
            return { plan, actions: [], verification, repairs: [], repairCount: 0, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, coverage: { available: false } };
        }

        testSnapshot = await captureProtectedTestSnapshot(workspace, protectedTestFiles);
        state = await saveState(workspace, { ...state, testFirst: testFirstEvidence, testSnapshot, multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : state.multiAgent ?? null, lastFailure: null });
    }

    const actions = Array.isArray(state.actions) ? [...state.actions] : [];
    const repairs = Array.isArray(state.repairs) ? [...state.repairs] : [];
    let repairCount = Number(state.repairCount ?? 0);
    let actionIndex = Math.max(0, Number(state.actionIndex ?? 0));

    for (; actionIndex < plan.actions.length; actionIndex++) {
        const action = plan.actions[actionIndex];
        let result;
        if (actionTouchesProtectedTest(action, protectedPaths)) {
            result = { index: actionIndex, type: action.type, status: "failed", path: action.path, error: "Implementation phase cannot modify a protected RED-proven test or visual baseline." };
        } else {
            result = await executeAction(action, workspace, { apply: true, index: actionIndex, executionProvider, computerSession });
        }
        actions.push({ ...result, phase: "main", attempt: 0 });

        if (result.status === "passed" && testSnapshot) {
            const integrity = await verifyProtectedTestSnapshot(workspace, testSnapshot);
            if (!integrity.passed) {
                result = { index: actionIndex, type: "test_integrity", status: "failed", changedTestFiles: integrity.changed, error: "Implementation changed a RED-proven test." };
                actions.push({ ...result, phase: "integrity", attempt: 0 });
            }
        }

        if (result.status === "failed") {
            let evidence = { kind: "action", actionIndex, action, result };
            let repaired = false;

            while (repairCount < maxRepairs) {
                repairCount++;
                const repairPlan = agentTeam?.enabled
                    ? await agentTeam.debug(task, await contextFor(workspace, task), evidence, repairCount, plan)
                    : await planner.repair(task, await contextFor(workspace, task), evidence, repairCount, plan);
                const repairResults = await executeRepairActions(repairPlan, workspace, true, protectedPaths, executionProvider, computerSession);
                const repairActionsPassed = repairResults.every((item) => item.status === "passed");
                const repairRecord = {
                    attempt: repairCount,
                    trigger: evidence,
                    rationale: repairPlan.rationale ?? "",
                    actions: repairPlan.actions,
                    results: repairResults,
                    retry: null
                };

                if (repairActionsPassed && repairPlan.actions.length > 0) {
                    result = actionTouchesProtectedTest(action, protectedPaths)
                        ? { index: actionIndex, type: action.type, status: "failed", path: action.path, error: "Implementation phase cannot modify a protected RED-proven test or visual baseline." }
                        : await executeAction(action, workspace, { apply: true, index: actionIndex, executionProvider, computerSession });
                    if (result.status === "passed" && testSnapshot) {
                        const integrity = await verifyProtectedTestSnapshot(workspace, testSnapshot);
                        if (!integrity.passed) result = { index: actionIndex, type: "test_integrity", status: "failed", changedTestFiles: integrity.changed };
                    }
                    repairRecord.retry = result;
                    actions.push({ ...result, phase: "retry", attempt: repairCount });
                    if (result.status === "passed") repaired = true;
                    else evidence = { kind: "action", actionIndex, action, result };
                } else {
                    evidence = {
                        kind: "repair_action",
                        actionIndex,
                        action,
                        repairResults,
                        message: repairPlan.actions.length === 0 ? "Repair planner returned no actions." : "A repair action failed."
                    };
                }

                repairs.push(repairRecord);
                state = await saveState(workspace, { ...state, actionIndex, actions, repairs, repairCount, testFirst: testFirstEvidence, testSnapshot, multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : state.multiAgent ?? null, lastFailure: repaired ? null : evidence });
                if (repaired) break;
            }

            if (!repaired) {
                const verification = await earlyFailure({ workspace, gitBaseline, task, reason: "repair budget exhausted after action failure" });
                state = await saveState(workspace, { ...state, actionIndex, actions, repairs, repairCount, testFirst: testFirstEvidence, testSnapshot, multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : state.multiAgent ?? null, status: "failed", lastFailure: evidence });
                return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, coverage: await collectCoverage(workspace) };
            }
        }

        state = await saveState(workspace, { ...state, actionIndex: actionIndex + 1, actions, repairs, repairCount, testFirst: testFirstEvidence, testSnapshot, multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : state.multiAgent ?? null, lastFailure: null });
    }

    let agentReview = null;
    if (agentTeam?.enabled) {
        let reviewRound = 0;
        while (true) {
            reviewRound++;
            const diff = await summarizeGitDiff(workspace, gitBaseline, task.expectedChangePaths ?? []);
            const reviewEvidence = {
                plan: { goal: plan.goal, rationale: plan.rationale, actionCount: plan.actions.length, verifyCount: plan.verify.length },
                actions: actions.map((item) => ({ type: item.type, status: item.status, phase: item.phase ?? null, path: item.path ?? null })),
                changedFiles: diff.available ? diff.changedFiles.map((item) => ({ path: item.path, status: item.status })) : [],
                unexpectedFiles: diff.available ? diff.unexpectedFiles.map((item) => ({ path: item.path, status: item.status })) : [],
                testFirst: testFirstEvidence ? { enabled: true, redPassed: Boolean(testFirstEvidence.red?.validRed) } : { enabled: false }
            };
            agentReview = await agentTeam.review(task, await contextFor(workspace, task), reviewEvidence, reviewRound);
            if (agentReview.verdict === "approve") break;

            if (!agentReview.policyPassed) {
                const verification = await earlyFailure({
                    workspace, gitBaseline, task,
                    reason: "reviewer violated read-only role policy",
                    checks: [{ index: 0, type: "agent_review", phase: "review", status: "failed", verdict: agentReview.verdict, findings: agentReview.findings }]
                });
                state = await saveState(workspace, { ...state, status: "failed", multiAgent: agentTeam.snapshot(), lastFailure: { kind: "agent_review_policy", review: agentReview } });
                return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, visual: { enabled: Boolean(visual?.enabled), passed: false, checks: [], evidencePaths: [] }, coverage: await collectCoverage(workspace), multiAgent: agentTeam.snapshot() };
            }

            if (reviewRound > agentTeam.maxReviewRounds) {
                const verification = await earlyFailure({
                    workspace, gitBaseline, task,
                    reason: "review change-request budget exhausted",
                    checks: [{ index: 0, type: "agent_review", phase: "review", status: "failed", verdict: agentReview.verdict, findings: agentReview.findings }]
                });
                state = await saveState(workspace, { ...state, status: "failed", multiAgent: agentTeam.snapshot(), lastFailure: { kind: "agent_review", review: agentReview } });
                return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, visual: { enabled: Boolean(visual?.enabled), passed: false, checks: [], evidencePaths: [] }, coverage: await collectCoverage(workspace), multiAgent: agentTeam.snapshot() };
            }

            const revision = await agentTeam.revise(task, await contextFor(workspace, task), agentReview, reviewRound, plan);
            const revisionResults = await executeRepairActions(revision, workspace, true, protectedPaths, executionProvider, computerSession);
            for (const [revisionIndex, result] of revisionResults.entries()) {
                actions.push({ ...result, index: actions.length, phase: "review-revision", attempt: reviewRound, revisionIndex });
            }
            if (revision.actions.length === 0 || revisionResults.some((item) => item.status === "failed")) {
                const verification = await earlyFailure({
                    workspace, gitBaseline, task,
                    reason: revision.actions.length === 0 ? "review requested changes but implementer returned no revision actions" : "review revision action failed",
                    checks: [{ index: 0, type: "agent_review_revision", phase: "review", status: "failed" }]
                });
                state = await saveState(workspace, { ...state, status: "failed", actions, multiAgent: agentTeam.snapshot(), lastFailure: { kind: "agent_review_revision", review: agentReview } });
                return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, visual: { enabled: Boolean(visual?.enabled), passed: false, checks: [], evidencePaths: [] }, coverage: await collectCoverage(workspace), multiAgent: agentTeam.snapshot() };
            }
            state = await saveState(workspace, { ...state, actions, multiAgent: agentTeam.snapshot(), lastFailure: null });
        }
    }

    let verification = await verifyWithEvidence(plan, workspace, task, gitBaseline, testSnapshot, visual, visualBaselineSnapshot, executionProvider, visionProvider, taskId, agentTeam);
    while (
        !verification.passed &&
        repairCount < maxRepairs &&
        !failedChecks(verification).some((check) => check.type === "agent_verifier" && check.policyPassed === false)
    ) {
        repairCount++;
        const evidence = { kind: "verification", failedChecks: failedChecks(verification) };
        const repairPlan = agentTeam?.enabled
                    ? await agentTeam.debug(task, await contextFor(workspace, task), evidence, repairCount, plan)
                    : await planner.repair(task, await contextFor(workspace, task), evidence, repairCount, plan);
        const repairResults = await executeRepairActions(repairPlan, workspace, true, protectedPaths, executionProvider, computerSession);
        const repairRecord = {
            attempt: repairCount,
            trigger: evidence,
            rationale: repairPlan.rationale ?? "",
            actions: repairPlan.actions,
            results: repairResults,
            retry: null
        };
        repairs.push(repairRecord);

        if (repairResults.every((item) => item.status === "passed") && repairPlan.actions.length > 0) {
            verification = await verifyWithEvidence(plan, workspace, task, gitBaseline, testSnapshot, visual, visualBaselineSnapshot, executionProvider, visionProvider, taskId, agentTeam);
            repairRecord.retry = { passed: verification.passed, failedChecks: failedChecks(verification) };
        }

        state = await saveState(workspace, {
            ...state,
            actionIndex: plan.actions.length,
            actions,
            repairs,
            repairCount,
            testFirst: testFirstEvidence,
            testSnapshot,
            multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : state.multiAgent ?? null,
            lastFailure: verification.passed ? null : { kind: "verification", failedChecks: failedChecks(verification) }
        });
    }

    const coverage = await collectCoverage(workspace);
    state = await saveState(workspace, {
        ...state,
        actionIndex: plan.actions.length,
        actions,
        repairs,
        repairCount,
        testFirst: testFirstEvidence,
        testSnapshot,
        multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : null,
        status: verification.passed ? "passed" : "failed",
        lastFailure: verification.passed ? null : { kind: "verification", failedChecks: failedChecks(verification) }
    });

    return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, visual: verification.visual ?? { enabled: false, passed: true, checks: [], evidencePaths: [] }, coverage, multiAgent: agentTeam?.enabled ? agentTeam.snapshot() : null };
}
