import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodePng, decodePng, writePng } from "../src/visual/png.js";
import { compareImages } from "../src/visual/diff.js";
import { captureVisualBaselineSnapshot, verifyVisualPlan } from "../src/visual/workflow.js";
import { OllamaVisionProvider } from "../src/visual/ollama.js";
import { ScriptedPlanner } from "../src/planners/scripted.js";
import { runTaskWithRepairs } from "../src/orchestration/repair-loop.js";

async function tempWorkspace() {
    return fs.mkdtemp(path.join(os.tmpdir(), "forgepilot-v06-"));
}

function solid(width, height, rgba) {
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = rgba[0]; pixels[i + 1] = rgba[1]; pixels[i + 2] = rgba[2]; pixels[i + 3] = rgba[3];
    }
    return { width, height, pixels };
}

function dataUrlBase64(buffer) {
    return buffer.toString("base64");
}

test("PNG codec round-trips RGBA evidence without external dependencies", async () => {
    const input = solid(3, 2, [12, 34, 56, 255]);
    input.pixels[4] = 200;
    const encoded = await encodePng(input);
    const decoded = await decodePng(encoded);
    assert.equal(decoded.width, 3);
    assert.equal(decoded.height, 2);
    assert.deepEqual(decoded.pixels, input.pixels);
});

test("pixel diff reports exact changed-pixel and delta evidence", async () => {
    const a = solid(2, 1, [0, 0, 0, 255]);
    const b = solid(2, 1, [0, 0, 0, 255]);
    b.pixels[4] = 100;
    const diff = compareImages(a, b);
    assert.equal(diff.comparable, true);
    assert.equal(diff.changedPixels, 1);
    assert.equal(diff.totalPixels, 2);
    assert.equal(diff.changedRatio, 0.5);
    assert.equal(diff.maxDelta, 100);
});

test("visual checkpoint captures evidence and passes dimensions, baseline, pixel, and region assertions", async () => {
    const workspace = await tempWorkspace();
    await fs.mkdir(path.join(workspace, "baselines"), { recursive: true });
    await fs.mkdir(path.join(workspace, "out"), { recursive: true });
    await writePng(path.join(workspace, "baselines", "ui.png"), solid(4, 3, [20, 40, 60, 255]));
    await writePng(path.join(workspace, "out", "ui.png"), solid(4, 3, [20, 40, 60, 255]));
    const visual = {
        enabled: true,
        checkpoints: [{
            name: "main-ui",
            capture: { path: "out/ui.png" },
            assertions: [
                { type: "dimensions", width: 4, height: 3 },
                { type: "pixel_diff", baseline: "baselines/ui.png", maxChangedRatio: 0 },
                { type: "pixel_probe", x: 0, y: 0, rgba: [20, 40, 60, 255] },
                { type: "region_mean", region: { x: 0, y: 0, width: 2, height: 2 }, rgba: [20, 40, 60, 255] }
            ]
        }]
    };
    const baselineSnapshot = await captureVisualBaselineSnapshot(visual, workspace);
    const result = await verifyVisualPlan(visual, workspace, { apply: true, taskId: "visual-pass", baselineSnapshot });
    assert.equal(result.passed, true);
    assert.equal(result.evidencePaths.length, 1);
    assert.ok(result.checks.every((check) => check.status === "passed"));
});

test("visual baseline integrity fails if a frozen baseline is changed after task start", async () => {
    const workspace = await tempWorkspace();
    await fs.mkdir(path.join(workspace, "baselines"), { recursive: true });
    await fs.mkdir(path.join(workspace, "out"), { recursive: true });
    await writePng(path.join(workspace, "baselines", "ui.png"), solid(2, 2, [1, 2, 3, 255]));
    await writePng(path.join(workspace, "out", "ui.png"), solid(2, 2, [1, 2, 3, 255]));
    const visual = { enabled: true, checkpoints: [{ name: "ui", capture: { path: "out/ui.png" }, assertions: [{ type: "pixel_diff", baseline: "baselines/ui.png" }] }] };
    const snapshot = await captureVisualBaselineSnapshot(visual, workspace);
    await writePng(path.join(workspace, "baselines", "ui.png"), solid(2, 2, [9, 9, 9, 255]));
    const result = await verifyVisualPlan(visual, workspace, { apply: true, taskId: "baseline-mutated", baselineSnapshot: snapshot });
    assert.equal(result.passed, false);
    assert.ok(result.checks.some((check) => check.type === "baseline_integrity" && check.status === "failed"));
});

test("implementation cannot rewrite a visual regression baseline", async () => {
    const workspace = await tempWorkspace();
    await fs.mkdir(path.join(workspace, "baselines"), { recursive: true });
    await fs.mkdir(path.join(workspace, "out"), { recursive: true });
    await writePng(path.join(workspace, "baselines", "ui.png"), solid(1, 1, [0, 0, 0, 255]));
    await writePng(path.join(workspace, "out", "ui.png"), solid(1, 1, [0, 0, 0, 255]));
    const task = {
        goal: "Do not let implementation replace visual evidence",
        actions: [{ type: "write_file", path: "baselines/ui.png", content: "not-a-real-png" }],
        verify: [],
        visual: { checkpoints: [{ name: "ui", capture: { path: "out/ui.png" }, assertions: [{ type: "pixel_diff", baseline: "baselines/ui.png" }] }] }
    };
    const result = await runTaskWithRepairs({ task, planner: new ScriptedPlanner(), plannerName: "scripted", workspace, apply: true, maxRepairs: 0, taskId: "protected-visual" });
    assert.equal(result.verification.passed, false);
    assert.ok(result.actions.some((action) => action.status === "failed" && /visual baseline/i.test(action.error ?? "")));
    const baseline = await decodePng(path.join(workspace, "baselines", "ui.png"));
    assert.equal(baseline.width, 1);
});

test("visual regression failure can trigger repair then recapture to PASS", async () => {
    const workspace = await tempWorkspace();
    await fs.mkdir(path.join(workspace, "baselines"), { recursive: true });
    await writePng(path.join(workspace, "baselines", "ui.png"), solid(2, 2, [0, 200, 80, 255]));
    const good = dataUrlBase64(await encodePng(solid(2, 2, [0, 200, 80, 255])));
    const bad = dataUrlBase64(await encodePng(solid(2, 2, [200, 0, 0, 255])));
    const renderer = `import fs from "node:fs";\nfs.mkdirSync("out", { recursive: true });\nconst image = "${bad}";\nfs.writeFileSync("out/ui.png", Buffer.from(image, "base64"));\n`;
    await fs.writeFile(path.join(workspace, "render.js"), renderer, "utf8");

    const task = {
        goal: "Repair the rendered UI until it matches the frozen baseline",
        actions: [],
        verify: [],
        visual: { checkpoints: [{ name: "ui", capture: { command: "node", args: ["render.js"], path: "out/ui.png" }, assertions: [{ type: "pixel_diff", baseline: "baselines/ui.png", maxChangedRatio: 0 }] }] },
        repairs: [{ rationale: "Render the expected green UI.", actions: [{ type: "replace_text", path: "render.js", find: bad, replace: good }] }]
    };
    const result = await runTaskWithRepairs({ task, planner: new ScriptedPlanner(), plannerName: "scripted", workspace, apply: true, maxRepairs: 1, taskId: "visual-repair" });
    assert.equal(result.repairCount, 1);
    assert.equal(result.verification.passed, true);
    assert.equal(result.visual.passed, true);
    assert.ok(result.repairs[0].trigger.failedChecks.some((check) => check.type === "pixel_diff"));
});

test("visual capture command is routed through the execution provider", async () => {
    const workspace = await tempWorkspace();
    const output = path.join(workspace, "out", "provider.png");
    const calls = [];
    const provider = {
        async run(spec) {
            calls.push(spec);
            await fs.mkdir(path.dirname(output), { recursive: true });
            await writePng(output, solid(1, 1, [7, 8, 9, 255]));
            return { command: spec.command, args: spec.args, exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
        }
    };
    const visual = { enabled: true, checkpoints: [{ name: "provider", capture: { command: "node", args: ["capture.js"], path: "out/provider.png" }, assertions: [{ type: "dimensions", width: 1, height: 1 }] }] };
    const result = await verifyVisualPlan(visual, workspace, { apply: true, executionProvider: provider, taskId: "provider", baselineSnapshot: {} });
    assert.equal(result.passed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "node");
    assert.ok(calls[0].allowedCommands.has("chromium"));
});

test("Ollama vision provider sends screenshot bytes and parses an evidence verdict", async () => {
    const workspace = await tempWorkspace();
    const imagePath = path.join(workspace, "ui.png");
    await writePng(imagePath, solid(1, 1, [1, 2, 3, 255]));
    let body;
    const provider = new OllamaVisionProvider({
        model: "qwen3-vl:8b",
        fetchImpl: async (_url, options) => {
            body = JSON.parse(options.body);
            return { ok: true, async json() { return { message: { content: JSON.stringify({ passed: true, confidence: 0.93, summary: "The status badge is visibly green.", observations: ["Green badge visible"] }) } }; } };
        }
    });
    const verdict = await provider.evaluate({ imagePath, prompt: "Confirm status", criteria: ["Status badge is green"] });
    assert.equal(verdict.passed, true);
    assert.equal(verdict.confidence, 0.93);
    assert.equal(body.model, "qwen3-vl:8b");
    assert.equal(body.messages[0].images.length, 1);
    assert.ok(body.messages[0].images[0].length > 20);
});

test("vision assertion fails closed when no vision provider is configured", async () => {
    const workspace = await tempWorkspace();
    await fs.mkdir(path.join(workspace, "out"), { recursive: true });
    await writePng(path.join(workspace, "out", "ui.png"), solid(1, 1, [1, 2, 3, 255]));
    const visual = { enabled: true, checkpoints: [{ name: "vision", capture: { path: "out/ui.png" }, assertions: [{ type: "vision", prompt: "Confirm the UI is ready" }] }] };
    const result = await verifyVisualPlan(visual, workspace, { apply: true, taskId: "no-vision", baselineSnapshot: {} });
    assert.equal(result.passed, false);
    assert.match(result.checks.find((check) => check.type === "vision").error, /no vision provider/i);
});
