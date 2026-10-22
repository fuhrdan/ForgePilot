import { executeAction, executePlan } from "../actions/executor.js";
import { verifyPlan } from "../verification/verifier.js";
import { getGitStatus, summarizeWorkspace } from "../core/workspace.js";
import { saveState } from "../core/state.js";

function failedChecks(verification) {
    return verification.checks.filter((check) => check.status === "failed");
}

async function contextFor(workspace) {
    return {
        workspace,
        git: await getGitStatus(workspace),
        files: await summarizeWorkspace(workspace)
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
    const initialContext = await contextFor(workspace);
    const plan = resumeState?.plan ?? await planner.plan(task, initialContext);

    if (!apply) {
        const actions = await executePlan(plan, workspace, { apply: false });
        const verification = await verifyPlan(plan, workspace, { apply: false });
        return { plan, actions, verification, repairs: [], repairCount: 0, resumed: false };
    }

    let state = resumeState ?? {
        version: 1,
        taskId,
        planner: plannerName,
        plan,
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
                    await contextFor(workspace),
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
                return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state };
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

    let verification = await verifyPlan(plan, workspace, { apply: true });
    while (!verification.passed && repairCount < maxRepairs) {
        repairCount++;
        const evidence = { kind: "verification", failedChecks: failedChecks(verification) };
        const repairPlan = await planner.repair(
            task,
            await contextFor(workspace),
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
            verification = await verifyPlan(plan, workspace, { apply: true });
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

    return { plan, actions, verification, repairs, repairCount, resumed: Boolean(resumeState), state };
}
