export class ScriptedPlanner {
    async plan(task) {
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
}
