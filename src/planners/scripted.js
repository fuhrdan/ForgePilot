export class ScriptedPlanner {
    async plan(task) {
        if (!Array.isArray(task.actions)) {
            throw new Error("Scripted task requires an actions array.");
        }

        return {
            goal: task.goal ?? "Scripted ForgePilot task",
            rationale: task.rationale ?? "Actions supplied by task file.",
            actions: task.actions,
            verify: task.verify ?? []
        };
    }
}
