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

export class OllamaPlanner {
    constructor({ model, baseUrl = "http://127.0.0.1:11434" }) {
        if (!model) throw new Error("Ollama planner requires a model name.");
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }

    async plan(task, context) {
        const prompt = buildPrompt(task, context);
        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                model: this.model,
                stream: false,
                format: "json",
                prompt
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);
        }

        const body = await response.json();
        return validatePlan(extractJson(body.response ?? ""));
    }
}

function buildPrompt(task, context) {
    return `You are ForgePilot's software-engineering planner. Produce JSON only.\n\n` +
        `Goal:\n${task.goal}\n\n` +
        `Workspace files:\n${context.files.join("\n") || "(empty workspace)"}\n\n` +
        `Git repository: ${context.git.isRepository ? "yes" : "no"}\n` +
        `Git branch: ${context.git.branch ?? "n/a"}\n\n` +
        `Return exactly this shape:\n` +
        `{\n  "goal": "...",\n  "rationale": "short explanation",\n  "actions": [\n` +
        `    {"type":"write_file","path":"relative/path","content":"full file content"},\n` +
        `    {"type":"run_command","command":"node","args":["file.js"],"expectExitCode":0}\n` +
        `  ],\n  "verify": [\n` +
        `    {"type":"file_exists","path":"relative/path"},\n` +
        `    {"type":"command","command":"node","args":["file.js"],"expectExitCode":0,"stdoutIncludes":"expected text"}\n` +
        `  ]\n}\n\n` +
        `Rules:\n` +
        `- Work only inside the provided workspace.\n` +
        `- Prefer small, reversible changes.\n` +
        `- Never use shell operators, redirection, pipes, curl, wget, powershell, cmd, bash, sh, sudo, rm, del, or network-download commands.\n` +
        `- Commands must be structured as command + args, never a shell string.\n` +
        `- Allowed commands are node, npm, npx, git, python, python3, pytest, go, java, javac, mvn, gradle, dotnet, cargo, rustc.\n` +
        `- Verification must test the finished result rather than merely restating the actions.\n` +
        `- Do not commit or push in v0.1.\n`;
}
