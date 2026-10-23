export class ScriptedPlanner {
    async strategy(task) {
        return {
            goal: task.goal ?? "Scripted ForgePilot task",
            approach: task.agentTeam?.strategy ?? task.rationale ?? "Follow the scripted implementation plan.",
            risks: task.agentTeam?.risks ?? [],
            acceptanceCriteria: task.agentTeam?.acceptanceCriteria ?? []
        };
    }

    async implement(task) {
        if (!Array.isArray(task.actions)) {
            throw new Error("Scripted task requires an actions array.");
        }

        return {
            goal: task.goal ?? "Scripted ForgePilot task",
            rationale: task.rationale ?? "Actions supplied by task file.",
            testFirst: task.testFirst ?? null,
            visual: task.visual ?? null,
            actions: task.actions,
            verify: task.verify ?? []
        };
    }

    async plan(task) {
        return this.implement(task);
    }

    async debug(task, context, evidence, attempt, originalPlan) {
        return this.repair(task, context, evidence, attempt, originalPlan);
    }

    async repair(task, _context, evidence, attempt) {
        const repair = Array.isArray(task.repairs) ? task.repairs[attempt - 1] : null;
        if (!repair) {
            return {
                rationale: `No scripted repair is defined for attempt ${attempt}.`,
                actions: [],
                verify: []
            };
        }

        return {
            rationale: repair.rationale ?? `Scripted repair attempt ${attempt} for ${evidence.kind} failure.`,
            actions: repair.actions ?? [],
            verify: repair.verify ?? []
        };
    }

    async review(task, _context, _evidence, round) {
        const configured = task.agentTeam?.reviews?.[round - 1];
        if (!configured) return { verdict: "approve", summary: "Scripted reviewer approved the implementation.", findings: [] };
        return configured;
    }

    async revise(task, _context, _review, round) {
        const configured = task.agentTeam?.revisions?.[round - 1];
        if (!configured) return { rationale: `No scripted reviewer revision is defined for round ${round}.`, actions: [], verify: [] };
        return {
            rationale: configured.rationale ?? `Scripted implementer revision ${round}.`,
            actions: configured.actions ?? [],
            verify: configured.verify ?? []
        };
    }

    async audit(task, _context, _evidence, sequence = 1) {
        const configured = task.agentTeam?.verifierAudits?.[Math.max(0, Number(sequence) - 1)];
        if (!configured) return { verdict: "approve", summary: "Scripted verifier approved deterministic evidence.", findings: [] };
        return configured;
    }
}
