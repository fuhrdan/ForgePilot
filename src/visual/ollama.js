import fs from "node:fs/promises";

function parseJson(text) {
    const trimmed = String(text ?? "").trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return JSON.parse(fenced ? fenced[1] : trimmed);
}

export class OllamaVisionProvider {
    constructor({ model, baseUrl = "http://127.0.0.1:11434", fetchImpl = fetch }) {
        if (!model) throw new Error("Ollama vision provider requires a model name.");
        this.model = model;
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.fetchImpl = fetchImpl;
        this.kind = "ollama";
    }

    describe() {
        return { kind: this.kind, model: this.model, baseUrl: this.baseUrl };
    }

    async evaluate({ imagePath, prompt, criteria = [] }) {
        const image = (await fs.readFile(imagePath)).toString("base64");
        const content = `You are ForgePilot's independent visual verifier. Evaluate only what is visibly supported by the supplied screenshot.\n` +
            `Return JSON only with this shape: {"passed":true|false,"confidence":0..1,"summary":"short evidence-based verdict","observations":["..."]}.\n` +
            `Do not assume hidden application state. If the image does not provide enough evidence, passed must be false.\n\n` +
            `Checkpoint request:\n${prompt || "Verify the expected UI state."}\n\n` +
            `Criteria:\n${criteria.length ? criteria.map((item) => `- ${item}`).join("\n") : "- Match the requested visible state."}`;
        const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                model: this.model,
                stream: false,
                format: "json",
                messages: [{ role: "user", content, images: [image] }]
            })
        });
        if (!response.ok) throw new Error(`Ollama vision returned HTTP ${response.status}: ${await response.text()}`);
        const body = await response.json();
        const verdict = parseJson(body.message?.content ?? "");
        return {
            passed: verdict.passed === true,
            confidence: Math.max(0, Math.min(1, Number(verdict.confidence ?? 0))),
            summary: String(verdict.summary ?? ""),
            observations: Array.isArray(verdict.observations) ? verdict.observations.map(String) : []
        };
    }
}
