import fs from "node:fs/promises";
import path from "node:path";
import { runSelfTest } from "./runtime-health.js";

export async function checkInstallation(rootDir, { workspace = "." } = {}) {
    const root = path.resolve(rootDir);
    const required = ["src/cli.js", "package.json", "README.md", "INSTALL_FORGEPILOT.cmd", "RUN_FORGEPILOT.cmd"];
    const files = [];
    for (const relative of required) {
        const full = path.join(root, relative);
        const stat = await fs.stat(full).catch(() => null);
        files.push({ path: relative, passed: Boolean(stat?.isFile()) });
    }
    const health = await runSelfTest({ workspace }).catch((error) => ({ passed: false, error: error.message, checks: [] }));
    return { passed: files.every((x) => x.passed) && Boolean(health.passed), files, health };
}

function semverTuple(value) {
    const match = String(value ?? "").replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : [0, 0, 0];
}
function compareVersions(a, b) {
    const aa = semverTuple(a), bb = semverTuple(b);
    for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return 0;
}

export async function checkForUpdate({ currentVersion, fetchImpl = globalThis.fetch, url = "https://api.github.com/repos/fuhrdan/ForgePilot/releases/latest", timeoutMs = 5000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { headers: { "accept": "application/vnd.github+json", "user-agent": `ForgePilot/${currentVersion}` }, signal: controller.signal });
        if (!response.ok) return { available: false, updateAvailable: false, error: `HTTP ${response.status}` };
        const body = await response.json();
        const latest = String(body?.tag_name ?? "").replace(/^v/, "");
        const asset = (body?.assets ?? []).find((item) => /windows\.zip$/i.test(item.name ?? ""));
        return {
            available: true,
            currentVersion,
            latestVersion: latest || null,
            updateAvailable: Boolean(latest && compareVersions(latest, currentVersion) > 0),
            releaseUrl: body?.html_url ?? null,
            asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
            error: null
        };
    } catch (error) {
        return { available: false, updateAvailable: false, error: error?.name === "AbortError" ? "timeout" : error.message };
    } finally { clearTimeout(timer); }
}
