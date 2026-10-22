import { executeAction, executePlan } from "../actions/executor.js";
import { verifyPlan } from "../verification/verifier.js";
import { getGitStatus } from "../core/workspace.js";
import { saveState } from "../core/state.js";
import { buildRepositoryContext } from "../repository/context.js";
import { captureGitBaseline, summarizeGitDiff } from "../repository/git-diff.js";

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

async function executeRepairActions(repairPlan, workspace, apply) {
    const results = [];
    for (let index = 0; index < repairPlan.actions.length; index++) {
        const result = await executeAction(repairPlan.actions[index], workspace, { apply, index });
        results.push(result);
        if (result.status === "failed") break;
    }
    return results;
}

function verificationOptions(task, gitBaseline) {
    return {
        apply: true,
        gitBaseline,
        expectedChangePaths: Array.isArray(task.expectedChangePaths) ? task.expectedChangePaths : [],
        enforceGitScope: task.enforceGitScope === true
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
    resumeState = null
}) {
    const initialContext = await contextFor(workspace, task);
    const plan = resumeState?.plan ?? await planner.plan(task, initialContext);
    const gitBaseline = resumeState?.gitBaseline ?? await captureGitBaseline(workspace);

    if (!apply) {
        const actions = await executePlan(plan, workspace, { apply: false });
        const verification = await verifyPlan(plan, workspace, {
            apply: false,
            gitBaseline,
            expectedChangePaths: task.expectedChangePaths ?? []
        });
        return { plan, actions, verification, repairs: [], repairCount: 0, resumed: false, repository: initialContext.repository };
    }

    let state = resumeState ?? {
        version: 2,
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
        lastFailure: null
    };

    state.status = "running";
    state.plan = plan;
    state.gitBaseline = gitBaseline;
    state = await saveState(workspace, state);

    const actions = Array.isArray(state.actions) ? [...state.actions] : [];
    const repairs = Array.isArray(state.repairs) ? [...state.repairs] : [];
    let repairCount = Number(state.repairCount ?? 0);
    let actionIndex = Math.max(0, Number(state.actionIndex ?? 0));

    for (; actionIndex < plan.actions.length; actionIndex++) {
        const action = plan.actions[actionIndex];
        let result = await executeAction(action, workspace, { apply: true, index: actionIndex });
        actions.push({ ...result, phase: "main", attempt: 0 });

        if (result.status === "failed") {
            let evidence = { kind: "action", actionIndex, action, result };
            let repaired = false;

            while (repairCount < maxRepairs) {
                repairCount++;
                const repairPlan = await planner.repair(
                    task,
                    await contextFor(workspace, task),
                    evidence,
                    repairCount,
                    plan
                );
                const repairResults = await executeRepairActions(repairPlan, workspace, true);
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
                    result = await executeAction(action, workspace, { apply: true, index: actionIndex });
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
                state = await saveState(workspace, {
                    ...state,
                    actionIndex,
                    actions,
                    repairs,
                    repairCount,
                    lastFailure: repaired ? null : evidence
                });
                if (repaired) break;
            }

            if (!repaired) {
                const verification = {
                    passed: false,
                    checks: [],
                    git: await getGitStatus(workspace),
                    gitDiff: await summarizeGitDiff(workspace, gitBaseline, task.expectedChangePaths ?? []),
                    skipped: "repair budget exhausted after action failure"
                };
                state = await saveState(workspace, {
                    ...state,
                    actionIndex,
                    actions,
                    repairs,
                    repairCount,
                    status: "failed",
                    lastFailure: evidence
                });
                return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository };
            }
        }

        state = await saveState(workspace, {
            ...state,
            actionIndex: actionIndex + 1,
            actions,
            repairs,
            repairCount,
            lastFailure: null
        });
    }

    let verification = await verifyPlan(plan, workspace, verificationOptions(task, gitBaseline));
    while (!verification.passed && repairCount < maxRepairs) {
        repairCount++;
        const evidence = { kind: "verification", failedChecks: failedChecks(verification) };
        const repairPlan = await planner.repair(
            task,
            await contextFor(workspace, task),
            evidence,
            repairCount,
            plan
        );
        const repairResults = await executeRepairActions(repairPlan, workspace, true);
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
            verification = await verifyPlan(plan, workspace, verificationOptions(task, gitBaseline));
            repairRecord.retry = { passed: verification.passed, failedChecks: failedChecks(verification) };
        }

        state = await saveState(workspace, {
            ...state,
            actionIndex: plan.actions.length,
            actions,
            repairs,
            repairCount,
            lastFailure: verification.passed ? null : { kind: "verification", failedChecks: failedChecks(verification) }
        });
    }

    state = await saveState(workspace, {
        ...state,
        actionIndex: plan.actions.length,
        actions,
        repairs,
        repairCount,
        status: verification.passed ? "passed" : "failed",
        lastFailure: verification.passed ? null : { kind: "verification", failedChecks: failedChecks(verification) }
    });

    return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state, repository: initialContext.repository };
}
