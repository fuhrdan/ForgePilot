function extractJson(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return JSON.parse(fenced ? fenced[1] : trimmed);
}

function validatePlan(plan) {
    if (!plan || typeof plan !== "object") throw new Error("Planner response is not an object.");
    if (!Array.isArray(plan.actions)) throw new Error("Planner response missing actions array.");
    if (!Array.isArray(plan.verify)) plan.verify = [];
    return plan;
}

function bounded(value, max = 12000) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

export class OllamaPlanner {
    constructor({ model, baseUrl = "http://127.0.0.1:11434" }) {
        if (!model) throw new Error("Ollama planner requires a model name.");
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }

    async generate(prompt) {
        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: this.model, stream: false, format: "json", prompt })
        });

        if (!response.ok) {
            throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);
        }

        const body = await response.json();
        return validatePlan(extractJson(body.response ?? ""));
    }

    async plan(task, context) {
        return this.generate(buildPlanPrompt(task, context));
    }

    async repair(task, context, evidence, attempt, originalPlan) {
        return this.generate(buildRepairPrompt(task, context, evidence, attempt, originalPlan));
    }
}

function actionSchema() {
    return `Allowed action shapes:\n` +
        `- {"type":"write_file","path":"relative/path","content":"full file content"}\n` +
        `- {"type":"replace_text","path":"relative/path","find":"exact existing text","replace":"replacement text","expectedOccurrences":1}\n` +
        `- {"type":"run_command","command":"node","args":["file.js"],"expectExitCode":0}\n`;
}

function safetyRules() {
    return `Rules:\n` +
        `- Work only inside the provided workspace.\n` +
        `- Prefer small, reversible changes. During repair, prefer replace_text over rewriting entire files.\n` +
        `- Never use shell operators, redirection, pipes, curl, wget, powershell, cmd, bash, sh, sudo, rm, del, or network-download commands.\n` +
        `- Commands must be structured as command + args, never a shell string.\n` +
        `- Allowed commands are node, npm, npx, git, python, python3, pytest, go, java, javac, mvn, gradle, dotnet, cargo, rustc.\n` +
        `- Verification must test the finished result rather than merely restating the actions.\n` +
        `- Do not commit or push.\n`;
}

function buildPlanPrompt(task, context) {
    return `You are ForgePilot's software-engineering planner. Produce JSON only.\n\n` +
        `Goal:\n${task.goal}\n\n` +
        `Workspace files:\n${context.files.join("\n") || "(empty workspace)"}\n\n` +
        `Git repository: ${context.git.isRepository ? "yes" : "no"}\n` +
        `Git branch: ${context.git.branch ?? "n/a"}\n\n` +
        `Return exactly this shape:\n` +
        `{\n  "goal": "...",\n  "rationale": "short explanation",\n  "actions": [...],\n  "verify": [...]\n}\n\n` +
        actionSchema() + `Verification supports file_exists, file_contains, and command checks.\n\n` + safetyRules();
}

function buildRepairPrompt(task, context, evidence, attempt, originalPlan) {
    return `You are ForgePilot's debugger. A previous implementation or verification step failed. Produce JSON only.\n\n` +
        `Goal:\n${task.goal}\n\n` +
        `Repair attempt: ${attempt}\n\n` +
        `Workspace files:\n${context.files.join("\n") || "(empty workspace)"}\n\n` +
        `Original plan:\n${bounded(originalPlan)}\n\n` +
        `Failure evidence:\n${bounded(evidence)}\n\n` +
        `Return exactly this shape:\n` +
        `{\n  "rationale": "diagnosis and repair strategy",\n  "actions": [...],\n  "verify": []\n}\n\n` +
        `Make the smallest change that plausibly fixes the supplied evidence. Do not claim success; ForgePilot will rerun the failing step independently.\n\n` +
        actionSchema() + safetyRules();
}
