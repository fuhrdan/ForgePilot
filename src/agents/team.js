import { enforceRolePolicy, ROLE_CAPABILITIES } from "./policy.js";

function cloneSafe(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function summarizePlan(plan) {
    return {
        goal: plan?.goal ?? null,
        rationale: plan?.rationale ?? null,
        actionCount: Array.isArray(plan?.actions) ? plan.actions.length : 0,
        verifyCount: Array.isArray(plan?.verify) ? plan.verify.length : 0,
        actionTypes: Array.isArray(plan?.actions) ? plan.actions.map((action) => action.type) : []
    };
}

function summarizeStrategy(strategy) {
    return {
        goal: strategy?.goal ?? null,
        approach: strategy?.approach ?? strategy?.rationale ?? null,
        risks: Array.isArray(strategy?.risks) ? strategy.risks.slice(0, 12) : [],
        acceptanceCriteria: Array.isArray(strategy?.acceptanceCriteria) ? strategy.acceptanceCriteria.slice(0, 20) : []
    };
}

function normalizeVerdict(payload, fallback = "approve") {
    const value = String(payload?.verdict ?? fallback).toLowerCase();
    if (["approve", "approved", "pass", "passed"].includes(value)) return "approve";
    if (["request_changes", "changes_requested", "reject", "rejected", "fail", "failed"].includes(value)) return "request_changes";
    throw new Error(`Unknown agent verdict: ${payload?.verdict}`);
}

function summarizeFindings(findings) {
    if (!Array.isArray(findings)) return [];
    return findings.slice(0, 50).map((item) => ({
        severity: String(item?.severity ?? "info"),
        path: item?.path ?? null,
        message: String(item?.message ?? item?.summary ?? "").slice(0, 1000)
    }));
}

export class AgentTeam {
    constructor({ adapter, adapters = {}, enabled = true, maxReviewRounds = 2, requireVerifierApproval = true } = {}) {
        if (!adapter) throw new Error("AgentTeam requires an adapter.");
        this.adapter = adapter;
        this.adapters = {
            planner: adapters.planner ?? adapter,
            implementer: adapters.implementer ?? adapter,
            debugger: adapters.debugger ?? adapter,
            reviewer: adapters.reviewer ?? adapter,
            verifier: adapters.verifier ?? adapter
        };
        this.enabled = Boolean(enabled);
        this.maxReviewRounds = Math.max(0, Number(maxReviewRounds ?? 2));
        this.requireVerifierApproval = requireVerifierApproval !== false;
        this.handoffs = [];
        this.reviews = [];
        this.verifierAudits = [];
        this.policyViolations = [];
        this.revisions = [];
    }

    restore(snapshot) {
        if (!snapshot || typeof snapshot !== "object") return;
        this.handoffs = cloneSafe(snapshot.handoffs ?? []);
        this.reviews = cloneSafe(snapshot.reviews ?? []);
        this.verifierAudits = cloneSafe(snapshot.verifierAudits ?? []);
        this.policyViolations = cloneSafe(snapshot.policyViolations ?? []);
        this.revisions = cloneSafe(snapshot.revisions ?? []);
    }

    recordHandoff(from, to, kind, summary) {
        this.handoffs.push({
            sequence: this.handoffs.length + 1,
            at: new Date().toISOString(),
            from,
            to,
            kind,
            summary: cloneSafe(summary)
        });
    }

    enforce(role, payload) {
        const policy = enforceRolePolicy(role, payload);
        if (!policy.passed) this.policyViolations.push(...policy.violations);
        return policy;
    }

    async prepare(task, context) {
        if (!this.enabled) return this.adapter.plan(task, context);

        const plannerAdapter = this.adapters.planner;
        const strategy = typeof plannerAdapter.strategy === "function"
            ? await plannerAdapter.strategy(task, context)
            : await plannerAdapter.plan(task, context);
        const plannerPolicy = this.enforce("planner", strategy);
        if (!plannerPolicy.passed) throw new Error(plannerPolicy.violations[0].message);
        this.recordHandoff("planner", "implementer", "strategy", summarizeStrategy(strategy));

        const implementerAdapter = this.adapters.implementer;
        const implementation = typeof implementerAdapter.implement === "function"
            ? await implementerAdapter.implement(task, context, strategy)
            : await implementerAdapter.plan(task, context);
        if (!implementation || !Array.isArray(implementation.actions)) throw new Error("Implementer did not return an actions array.");
        if (!Array.isArray(implementation.verify)) implementation.verify = [];
        this.recordHandoff("implementer", "orchestrator", "implementation_plan", summarizePlan(implementation));
        return implementation;
    }

    async debug(task, context, evidence, attempt, originalPlan) {
        const debuggerAdapter = this.adapters.debugger;
        const repair = typeof debuggerAdapter.debug === "function"
            ? await debuggerAdapter.debug(task, context, evidence, attempt, originalPlan)
            : await debuggerAdapter.repair(task, context, evidence, attempt, originalPlan);
        if (!repair || !Array.isArray(repair.actions)) throw new Error("Debugger did not return an actions array.");
        this.recordHandoff("debugger", "orchestrator", "repair_plan", {
            attempt,
            trigger: evidence?.kind ?? "unknown",
            rationale: repair.rationale ?? "",
            actionCount: repair.actions.length,
            actionTypes: repair.actions.map((action) => action.type)
        });
        return repair;
    }

    async review(task, context, evidence, round) {
        const reviewerAdapter = this.adapters.reviewer;
        const raw = typeof reviewerAdapter.review === "function"
            ? await reviewerAdapter.review(task, context, evidence, round)
            : { verdict: "approve", summary: "No reviewer adapter configured.", findings: [] };
        const policy = this.enforce("reviewer", raw);
        const review = {
            round,
            verdict: policy.passed ? normalizeVerdict(raw) : "request_changes",
            summary: policy.passed ? String(raw?.summary ?? "") : "Reviewer violated read-only role policy.",
            findings: policy.passed ? summarizeFindings(raw?.findings) : policy.violations.map((item) => ({ severity: "error", path: null, message: item.message })),
            policyPassed: policy.passed
        };
        this.reviews.push(review);
        this.recordHandoff("reviewer", review.verdict === "approve" ? "verifier" : "implementer", "review_verdict", review);
        return review;
    }

    async revise(task, context, review, round, originalPlan) {
        const implementerAdapter = this.adapters.implementer;
        const revision = typeof implementerAdapter.revise === "function"
            ? await implementerAdapter.revise(task, context, review, round, originalPlan)
            : { rationale: "No implementer revision adapter configured.", actions: [], verify: [] };
        if (!revision || !Array.isArray(revision.actions)) throw new Error("Implementer revision did not return an actions array.");
        const record = {
            round,
            rationale: revision.rationale ?? "",
            actionCount: revision.actions.length,
            actionTypes: revision.actions.map((action) => action.type)
        };
        this.revisions.push(record);
        this.recordHandoff("implementer", "reviewer", "review_revision", record);
        return revision;
    }

    async audit(task, context, evidence) {
        const verifierAdapter = this.adapters.verifier;
        const raw = typeof verifierAdapter.audit === "function"
            ? await verifierAdapter.audit(task, context, evidence, this.verifierAudits.length + 1)
            : { verdict: "approve", summary: "No verifier adapter configured.", findings: [] };
        const policy = this.enforce("verifier", raw);
        const audit = {
            sequence: this.verifierAudits.length + 1,
            verdict: policy.passed ? normalizeVerdict(raw) : "request_changes",
            summary: policy.passed ? String(raw?.summary ?? "") : "Verifier violated read-only role policy.",
            findings: policy.passed ? summarizeFindings(raw?.findings) : policy.violations.map((item) => ({ severity: "error", path: null, message: item.message })),
            policyPassed: policy.passed
        };
        this.verifierAudits.push(audit);
        this.recordHandoff("verifier", "orchestrator", "verification_audit", audit);
        return audit;
    }

    snapshot() {
        return {
            enabled: this.enabled,
            maxReviewRounds: this.maxReviewRounds,
            requireVerifierApproval: this.requireVerifierApproval,
            roles: ROLE_CAPABILITIES,
            models: Object.fromEntries(Object.entries(this.adapters).map(([role, adapter]) => [role, adapter?.model ?? adapter?.constructor?.name ?? "unknown"])),
            handoffs: cloneSafe(this.handoffs),
            reviews: cloneSafe(this.reviews),
            revisions: cloneSafe(this.revisions),
            verifierAudits: cloneSafe(this.verifierAudits),
            policyViolations: cloneSafe(this.policyViolations)
        };
    }
}
