import { executeAction, executePlan } from "../actions/executor.js";
import { verifyPlan } from "../verification/verifier.js";
import { getGitStatus } from "../core/workspace.js";
import { saveState } from "../core/state.js";
import { buildRepositoryContext } from "../repository/context.js";
import { captureGitBaseline, summarizeGitDiff } from "../repository/git-diff.js";
import { collectCoverage } from "../testing/coverage.js";
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

async function executeRepairActions(repairPlan, workspace, apply, protectedPaths = [], executionProvider = null) {
    const results = [];
    for (let index = 0; index < repairPlan.actions.length; index++) {
        const action = repairPlan.actions[index];
        if (actionTouchesProtectedTest(action, protectedPaths)) {
            results.push({
                index,
                type: action.type,
                status: "failed",
                path: action.path,
                error: "Repair attempted to modify a RED-proven test. Test files are immutable during implementation."
            });
            break;
        }
        const result = await executeAction(action, workspace, { apply, index, executionProvider });
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

async function verifyWithTestIntegrity(plan, workspace, task, gitBaseline, testSnapshot, executionProvider = null) {
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
    executionProvider = null
}) {
    const initialContext = await contextFor(workspace, task);
    const planned = resumeState?.plan ?? await planner.plan(task, initialContext);
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
    const plan = testFirst ? appendEngineeringGates(planned, testFirst) : planned;
    const gitBaseline = resumeState?.gitBaseline ?? await captureGitBaseline(workspace);

    if (!apply) {
        const testAuthoring = testFirst ? await executeTestAuthoring(testFirst, workspace, { apply: false, executionProvider }) : [];
        const actions = await executePlan(plan, workspace, { apply: false, executionProvider });
        const verification = await verifyPlan(plan, workspace, {
            apply: false,
            gitBaseline,
            expectedChangePaths: task.expectedChangePaths ?? [],
            executionProvider
        });
        return {
            plan, actions, verification, repairs: [], repairCount: 0, resumed: false,
            repository: initialContext.repository,
            testFirst: testFirst ? { enabled: true, authoring: testAuthoring, red: null, testOnlyDiff: null } : null,
            coverage: { available: false }
        };
    }

    let state = resumeState ?? {
        version: 4,
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
        testSnapshot: null
    };

    state.status = "running";
    state.plan = plan;
    state.gitBaseline = gitBaseline;
    state = await saveState(workspace, state);

    let testFirstEvidence = state.testFirst ?? null;
    let testSnapshot = state.testSnapshot ?? null;
    let protectedPaths = testFirst ? protectedTestPaths(testFirst) : [];

    if (testFirst && !testFirstEvidence?.red?.validRed) {
        const authoring = await executeTestAuthoring(testFirst, workspace, { apply: true, executionProvider });
        if (authoring.some((item) => item.status === "failed")) {
            const verification = await earlyFailure({
                workspace, gitBaseline, task,
                reason: "test authoring failed before RED gate",
                checks: authoring.map((item, index) => ({ index, type: "test_authoring", phase: "author", status: item.status, ...item }))
            });
            testFirstEvidence = { enabled: true, authoring, testOnlyDiff: null, red: null };
            state = await saveState(workspace, { ...state, status: "failed", testFirst: testFirstEvidence, lastFailure: { kind: "test_authoring", authoring } });
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
            state = await saveState(workspace, { ...state, status: "failed", testFirst: testFirstEvidence, lastFailure: { kind: "test_change_policy", testOnlyDiff } });
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
            state = await saveState(workspace, { ...state, status: "failed", testFirst: testFirstEvidence, lastFailure: { kind: "red_gate", red } });
            return { plan, actions: [], verification, repairs: [], repairCount: 0, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, coverage: { available: false } };
        }

        testSnapshot = await captureProtectedTestSnapshot(workspace, protectedPaths);
        state = await saveState(workspace, { ...state, testFirst: testFirstEvidence, testSnapshot, lastFailure: null });
    }

    const actions = Array.isArray(state.actions) ? [...state.actions] : [];
    const repairs = Array.isArray(state.repairs) ? [...state.repairs] : [];
    let repairCount = Number(state.repairCount ?? 0);
    let actionIndex = Math.max(0, Number(state.actionIndex ?? 0));

    for (; actionIndex < plan.actions.length; actionIndex++) {
        const action = plan.actions[actionIndex];
        let result;
        if (actionTouchesProtectedTest(action, protectedPaths)) {
            result = { index: actionIndex, type: action.type, status: "failed", path: action.path, error: "Implementation phase cannot modify a RED-proven test." };
        } else {
            result = await executeAction(action, workspace, { apply: true, index: actionIndex, executionProvider });
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
                const repairPlan = await planner.repair(task, await contextFor(workspace, task), evidence, repairCount, plan);
                const repairResults = await executeRepairActions(repairPlan, workspace, true, protectedPaths, executionProvider);
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
                        ? { index: actionIndex, type: action.type, status: "failed", path: action.path, error: "Implementation phase cannot modify a RED-proven test." }
                        : await executeAction(action, workspace, { apply: true, index: actionIndex, executionProvider });
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
                state = await saveState(workspace, { ...state, actionIndex, actions, repairs, repairCount, testFirst: testFirstEvidence, testSnapshot, lastFailure: repaired ? null : evidence });
                if (repaired) break;
            }

            if (!repaired) {
                const verification = await earlyFailure({ workspace, gitBaseline, task, reason: "repair budget exhausted after action failure" });
                state = await saveState(workspace, { ...state, actionIndex, actions, repairs, repairCount, testFirst: testFirstEvidence, testSnapshot, status: "failed", lastFailure: evidence });
                return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, coverage: await collectCoverage(workspace) };
            }
        }

        state = await saveState(workspace, { ...state, actionIndex: actionIndex + 1, actions, repairs, repairCount, testFirst: testFirstEvidence, testSnapshot, lastFailure: null });
    }

    let verification = await verifyWithTestIntegrity(plan, workspace, task, gitBaseline, testSnapshot, executionProvider);
    while (!verification.passed && repairCount < maxRepairs) {
        repairCount++;
        const evidence = { kind: "verification", failedChecks: failedChecks(verification) };
        const repairPlan = await planner.repair(task, await contextFor(workspace, task), evidence, repairCount, plan);
        const repairResults = await executeRepairActions(repairPlan, workspace, true, protectedPaths, executionProvider);
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
            verification = await verifyWithTestIntegrity(plan, workspace, task, gitBaseline, testSnapshot, executionProvider);
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
        status: verification.passed ? "passed" : "failed",
        lastFailure: verification.passed ? null : { kind: "verification", failedChecks: failedChecks(verification) }
    });

    return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository, testFirst: testFirstEvidence, coverage };
}
