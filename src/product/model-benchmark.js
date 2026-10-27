import { inspectOllama } from "./runtime-health.js";

function preferredOrder(models) {
    const rank = ["1.5b", "3b", "7b", "14b", "32b"];
    return [...models].sort((a, b) => {
        const ia = rank.findIndex((x) => a.includes(x));
        const ib = rank.findIndex((x) => b.includes(x));
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
}

export async function benchmarkOllamaModels({ baseUrl = "http://127.0.0.1:11434", models = null, fetchImpl = globalThis.fetch, timeoutMs = 30000, maxModels = 3 } = {}) {
    const state = models ? { available: true, models } : await inspectOllama({ baseUrl, fetchImpl, timeoutMs: Math.min(timeoutMs, 3000) });
    if (!state.available) return { available: false, results: [], recommended: null, error: state.error ?? "Ollama unavailable" };
    const selected = preferredOrder(state.models).slice(0, Math.max(1, maxModels));
    const results = [];
    for (const model of selected) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const started = Date.now();
        try {
            const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/api/generate`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ model, prompt: "Return exactly: FORGEPILOT_BENCH_OK", stream: false, options: { temperature: 0, num_predict: 12 } }),
                signal: controller.signal
            });
            const elapsedMs = Date.now() - started;
            if (!response.ok) {
                results.push({ model, passed: false, elapsedMs, error: `HTTP ${response.status}` });
                continue;
            }
            const body = await response.json();
            const text = String(body?.response ?? "");
            const passed = text.includes("FORGEPILOT_BENCH_OK") || text.trim().length > 0;
            const evalCount = Number(body?.eval_count ?? 0);
            const evalDurationNs = Number(body?.eval_duration ?? 0);
            const tokensPerSecond = evalCount > 0 && evalDurationNs > 0 ? Number((evalCount / (evalDurationNs / 1e9)).toFixed(2)) : null;
            results.push({ model, passed, elapsedMs, tokensPerSecond, error: passed ? null : "empty response" });
        } catch (error) {
            results.push({ model, passed: false, elapsedMs: Date.now() - started, error: error?.name === "AbortError" ? "timeout" : error.message });
        } finally { clearTimeout(timer); }
    }
    const viable = results.filter((item) => item.passed).sort((a, b) => a.elapsedMs - b.elapsedMs);
    return { available: true, results, recommended: viable[0]?.model ?? null, error: viable.length ? null : "No installed model completed the benchmark." };
}
