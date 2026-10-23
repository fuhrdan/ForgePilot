import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_ALLOWED_COMMANDS, runCommand } from "../core/command.js";
import { resolveInside } from "../core/paths.js";
import { decodePng } from "./png.js";
import { compareImages, probePixel, regionMean } from "./diff.js";

const VISUAL_CAPTURE_COMMANDS = new Set([
    ...DEFAULT_ALLOWED_COMMANDS,
    "chromium", "chromium-browser", "google-chrome", "google-chrome-stable"
]);

function safeName(value) {
    return String(value ?? "checkpoint").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "checkpoint";
}

async function sha256(file) {
    return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function exists(file) {
    try { await fs.access(file); return true; } catch { return false; }
}

export function normalizeVisual(plan, task = {}) {
    const raw = task.visual ?? plan.visual ?? null;
    if (!raw || raw.enabled === false) return null;
    const checkpoints = Array.isArray(raw.checkpoints) ? raw.checkpoints : [];
    return { enabled: true, checkpoints };
}

export function visualBaselinePaths(visual) {
    if (!visual) return [];
    const paths = [];
    for (const checkpoint of visual.checkpoints ?? []) {
        for (const assertion of checkpoint.assertions ?? []) {
            if (assertion.type === "pixel_diff" && assertion.baseline) paths.push(String(assertion.baseline).replaceAll("\\", "/"));
        }
    }
    return [...new Set(paths)];
}

export async function captureVisualBaselineSnapshot(visual, workspace) {
    const snapshot = {};
    for (const relative of visualBaselinePaths(visual)) {
        const absolute = resolveInside(workspace, relative);
        snapshot[relative] = {
            path: relative,
            exists: await exists(absolute),
            hash: await exists(absolute) ? await sha256(absolute) : null
        };
    }
    return snapshot;
}

export function actionTouchesProtectedVisual(action, baselinePaths = []) {
    return ["write_file", "replace_text"].includes(action?.type) && action.path && baselinePaths.includes(String(action.path));
}

async function captureCheckpoint(checkpoint, workspace, { executionProvider, taskId }) {
    const capture = checkpoint.capture ?? {};
    const sourceRelative = String(capture.path ?? checkpoint.path ?? "");
    if (!sourceRelative) throw new Error(`Visual checkpoint ${checkpoint.name ?? "unnamed"} requires capture.path.`);

    let commandResult = null;
    if (capture.command) {
        const runner = executionProvider?.run ? executionProvider.run.bind(executionProvider) : runCommand;
        commandResult = await runner({
            command: String(capture.command),
            args: Array.isArray(capture.args) ? capture.args.map(String) : [],
            cwd: resolveInside(workspace, capture.cwd ?? "."),
            timeoutMs: Number(capture.timeoutMs ?? 120000),
            allowedCommands: VISUAL_CAPTURE_COMMANDS
        });
        const expected = Number(capture.expectExitCode ?? 0);
        if (commandResult.exitCode !== expected || commandResult.timedOut) {
            return { passed: false, sourceRelative, commandResult, error: `Capture command exited ${commandResult.exitCode}; expected ${expected}.` };
        }
    }

    const source = resolveInside(workspace, sourceRelative);
    if (!(await exists(source))) return { passed: false, sourceRelative, commandResult, error: "Screenshot file was not produced." };

    const extension = path.extname(sourceRelative).toLowerCase();
    if (extension !== ".png") return { passed: false, sourceRelative, commandResult, error: "ForgePilot v0.6 visual verification currently supports PNG screenshots." };

    const evidenceRelative = path.posix.join(".forgepilot", "visual", safeName(taskId), `${safeName(checkpoint.name ?? path.basename(sourceRelative, extension))}.png`);
    const evidencePath = resolveInside(workspace, evidenceRelative);
    await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    await fs.copyFile(source, evidencePath);
    const image = await decodePng(evidencePath);
    return { passed: true, sourceRelative, evidenceRelative, evidencePath, commandResult, image, sha256: await sha256(evidencePath) };
}

function within(actual, expected, tolerance) {
    return Math.abs(Number(actual) - Number(expected)) <= Number(tolerance ?? 0);
}

async function evaluateAssertion(assertion, image, workspace, baselineSnapshot, visionProvider, evidencePath) {
    if (assertion.type === "dimensions") {
        const widthOkay = assertion.width === undefined || image.width === Number(assertion.width);
        const heightOkay = assertion.height === undefined || image.height === Number(assertion.height);
        return { type: assertion.type, passed: widthOkay && heightOkay, width: image.width, height: image.height, expectedWidth: assertion.width, expectedHeight: assertion.height };
    }

    if (assertion.type === "pixel_diff") {
        const baselineRelative = String(assertion.baseline ?? "").replaceAll("\\", "/");
        const frozen = baselineSnapshot?.[baselineRelative];
        const baselinePath = resolveInside(workspace, baselineRelative);
        if (!frozen?.exists || !(await exists(baselinePath))) return { type: assertion.type, passed: false, baseline: baselineRelative, error: "Visual baseline is missing." };
        const currentHash = await sha256(baselinePath);
        if (currentHash !== frozen.hash) return { type: "baseline_integrity", passed: false, baseline: baselineRelative, expectedHash: frozen.hash, actualHash: currentHash, error: "Visual baseline changed after the task started." };
        const baseline = await decodePng(baselinePath);
        const metrics = compareImages(image, baseline, { channelThreshold: Number(assertion.channelThreshold ?? 0), region: assertion.region ?? null });
        const maxChangedRatio = Number(assertion.maxChangedRatio ?? 0);
        const maxMeanDelta = assertion.maxMeanDelta === undefined ? Infinity : Number(assertion.maxMeanDelta);
        const maxRmsDelta = assertion.maxRmsDelta === undefined ? Infinity : Number(assertion.maxRmsDelta);
        const passed = metrics.comparable && metrics.changedRatio <= maxChangedRatio && metrics.meanDelta <= maxMeanDelta && metrics.rmsDelta <= maxRmsDelta;
        return { type: assertion.type, passed, baseline: baselineRelative, maxChangedRatio, maxMeanDelta: Number.isFinite(maxMeanDelta) ? maxMeanDelta : null, maxRmsDelta: Number.isFinite(maxRmsDelta) ? maxRmsDelta : null, ...metrics };
    }

    if (assertion.type === "pixel_probe") {
        const actual = probePixel(image, assertion.x, assertion.y);
        const expected = Array.isArray(assertion.rgba) ? assertion.rgba.map(Number) : [];
        const tolerance = Number(assertion.tolerance ?? 0);
        const passed = expected.length === 4 && actual.every((value, index) => within(value, expected[index], tolerance));
        return { type: assertion.type, passed, x: Number(assertion.x), y: Number(assertion.y), actual, expected, tolerance };
    }

    if (assertion.type === "region_mean") {
        const result = regionMean(image, assertion.region);
        const expected = Array.isArray(assertion.rgba) ? assertion.rgba.map(Number) : [];
        const tolerance = Number(assertion.tolerance ?? 0);
        const passed = expected.length === 4 && result.rgba.every((value, index) => within(value, expected[index], tolerance));
        return { type: assertion.type, passed, actual: result.rgba, expected, tolerance, region: result.region };
    }

    if (assertion.type === "vision") {
        if (!visionProvider?.evaluate) return { type: assertion.type, passed: false, error: "Vision assertion requested but no vision provider is configured." };
        try {
            const verdict = await visionProvider.evaluate({ imagePath: evidencePath, prompt: assertion.prompt ?? "", criteria: Array.isArray(assertion.criteria) ? assertion.criteria : [] });
            const minConfidence = Number(assertion.minConfidence ?? 0);
            return { type: assertion.type, passed: verdict.passed && verdict.confidence >= minConfidence, minConfidence, ...verdict, provider: visionProvider.describe?.() ?? { kind: "custom" } };
        } catch (error) {
            return { type: assertion.type, passed: false, error: error.message, provider: visionProvider.describe?.() ?? { kind: "custom" } };
        }
    }

    return { type: assertion.type, passed: false, error: `Unsupported visual assertion type: ${assertion.type}` };
}

export async function verifyVisualPlan(visual, workspace, {
    apply = false,
    executionProvider = null,
    visionProvider = null,
    taskId = "task",
    baselineSnapshot = null
} = {}) {
    if (!visual) return { enabled: false, passed: true, checks: [], evidencePaths: [] };
    if (!apply) {
        return {
            enabled: true,
            passed: null,
            checks: (visual.checkpoints ?? []).flatMap((checkpoint) => [
                { type: "visual_capture", checkpoint: checkpoint.name ?? "checkpoint", status: "planned" },
                ...(checkpoint.assertions ?? []).map((assertion) => ({ type: assertion.type, checkpoint: checkpoint.name ?? "checkpoint", status: "planned" }))
            ]),
            evidencePaths: []
        };
    }

    const checks = [];
    const evidencePaths = [];
    for (const checkpoint of visual.checkpoints ?? []) {
        let captured;
        try {
            captured = await captureCheckpoint(checkpoint, workspace, { executionProvider, taskId });
        } catch (error) {
            captured = { passed: false, error: error.message };
        }
        checks.push({
            type: "visual_capture",
            checkpoint: checkpoint.name ?? "checkpoint",
            status: captured.passed ? "passed" : "failed",
            source: captured.sourceRelative,
            evidence: captured.evidenceRelative,
            sha256: captured.sha256,
            width: captured.image?.width,
            height: captured.image?.height,
            commandResult: captured.commandResult,
            error: captured.error
        });
        if (!captured.passed) continue;
        evidencePaths.push(captured.evidenceRelative);

        for (const assertion of checkpoint.assertions ?? []) {
            let result;
            try {
                result = await evaluateAssertion(assertion, captured.image, workspace, baselineSnapshot, visionProvider, captured.evidencePath);
            } catch (error) {
                result = { type: assertion.type, passed: false, error: error.message };
            }
            checks.push({ ...result, checkpoint: checkpoint.name ?? "checkpoint", status: result.passed ? "passed" : "failed" });
        }
    }

    return { enabled: true, passed: checks.every((check) => check.status === "passed"), checks, evidencePaths };
}
