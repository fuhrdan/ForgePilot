import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { OllamaPlanner } from "../src/planners/ollama.js";

test("OllamaPlanner parses structured plan", async () => {
    const server = http.createServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ response: JSON.stringify({ goal: "x", rationale: "y", actions: [], verify: [] }) }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const planner = new OllamaPlanner({ model: "test", baseUrl: `http://127.0.0.1:${address.port}` });
    const plan = await planner.plan({ goal: "test" }, { files: [], git: { isRepository: false, branch: null } });
    assert.equal(plan.goal, "x");
    assert.deepEqual(plan.actions, []);
    await new Promise((resolve) => server.close(resolve));
});
