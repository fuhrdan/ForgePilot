import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { writeZip } from "./zip.js";
import { scanRepository } from "../repository/scanner.js";
import { detectProjects } from "../repository/detector.js";

const IGNORE_PREFIXES = [".git/", ".forgepilot/", "node_modules/", ".venv/", "venv/", "__pycache__/", ".idea/", ".vscode/"];
const BINARY_EXTS = new Set([".exe", ".msi", ".msix", ".jar", ".war", ".whl", ".appimage", ".dmg", ".apk", ".zip"]);
const BUILD_PREFIXES = ["dist/", "build/", "target/", "out/", "export/", "releases/", "bin/release/"];

function safeName(value) {
    return String(value ?? "ForgePilot-Deliverable").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "ForgePilot-Deliverable";
}

function ignored(relative) {
    const lower = relative.toLowerCase().replaceAll("\\", "/");
    return IGNORE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

async function hashFile(file) {
    const hash = crypto.createHash("sha256");
    const data = await fs.readFile(file);
    hash.update(data);
    return hash.digest("hex");
}


async function findBuiltArtifacts(root, maxPackageBytes) {
    const roots = ["dist", "build", "target", "out", "export", "releases", path.join("bin", "Release")];
    const found = [];
    async function walk(dir) {
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (found.length >= 8) return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { await walk(full); continue; }
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!BINARY_EXTS.has(ext)) continue;
            const stat = await fs.stat(full).catch(() => null);
            if (!stat || stat.size > maxPackageBytes) continue;
            found.push(full);
        }
    }
    for (const relative of roots) await walk(path.join(root, relative));
    return found;
}

function launcherFor(project, files, pkg) {
    if (project?.ecosystem === "node") {
        let entry = pkg?.main && files.includes(pkg.main) ? pkg.main : null;
        for (const candidate of ["app.js", "index.js", "server.js", "src/index.js", "src/app.js"]) if (!entry && files.includes(candidate)) entry = candidate;
        if (entry) return {
            entry,
            windows: `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nnode "${entry.replaceAll("/", "\\")}" %*\r\n`,
            unix: `#!/usr/bin/env sh\ncd "$(dirname "$0")"\nexec node "${entry}" "$@"\n`
        };
    }
    if (project?.ecosystem === "python") {
        const entry = ["main.py", "app.py", "src/main.py"].find((item) => files.includes(item));
        if (entry) return {
            entry,
            windows: `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\npython "${entry.replaceAll("/", "\\")}" %*\r\n`,
            unix: `#!/usr/bin/env sh\ncd "$(dirname "$0")"\nexec python3 "${entry}" "$@"\n`
        };
    }
    return null;
}

async function readPackage(workspace) {
    try { return JSON.parse(await fs.readFile(path.join(workspace, "package.json"), "utf8")); } catch { return null; }
}

export async function finalizeDeliverable(workspace, { taskId = "latest", projectName = null, maxPackageBytes = 64 * 1024 * 1024 } = {}) {
    const root = path.resolve(workspace);
    const scan = await scanRepository(root, { maxFiles: 10000 });
    const files = (scan.files ?? []).filter((item) => !ignored(item));
    const projects = await detectProjects(root, files);
    const project = projects[0] ?? { ecosystem: "generic", language: "Unknown" };
    const pkg = await readPackage(root);
    const name = safeName(projectName ?? pkg?.name ?? path.basename(root));
    const directory = path.join(root, ".forgepilot", "deliverables", String(taskId));
    await fs.mkdir(directory, { recursive: true });

    const built = [];
    for (const source of await findBuiltArtifacts(root, maxPackageBytes)) {
        const relative = path.relative(root, source).replaceAll("\\", "/");
        const stat = await fs.stat(source);
        let target = path.join(directory, path.basename(source));
        if (built.some((item) => path.basename(item.path) === path.basename(target))) target = path.join(directory, `${built.length + 1}-${path.basename(source)}`);
        await fs.copyFile(source, target);
        built.push({ path: target, relative, size: stat.size, sha256: await hashFile(target), kind: "built-artifact" });
    }

    const launcher = launcherFor(project, files, pkg);
    const entries = [];
    let packageBytes = 0;
    for (const relative of files) {
        if (ignored(relative)) continue;
        const full = path.join(root, ...relative.split("/"));
        const stat = await fs.stat(full).catch(() => null);
        if (!stat?.isFile() || stat.size > 8 * 1024 * 1024) continue;
        if (packageBytes + stat.size > maxPackageBytes) break;
        const data = await fs.readFile(full);
        entries.push({ name: relative, data, mtime: stat.mtime });
        packageBytes += stat.size;
    }
    if (launcher) {
        entries.push({ name: "RUN.cmd", data: launcher.windows });
        entries.push({ name: "run.sh", data: launcher.unix });
    }
    const readme = [
        `ForgePilot finished deliverable: ${name}`,
        `Project type: ${project.ecosystem} / ${project.language}`,
        launcher ? `Run entry point: ${launcher.entry}` : "No automatic launcher was identified; use the project's normal build/run instructions.",
        `Generated: ${new Date().toISOString()}`,
        "",
        "This package excludes .git, .forgepilot state, dependency caches, and editor metadata."
    ].join("\n") + "\n";
    entries.push({ name: "FORGEPILOT-DELIVERABLE.txt", data: readme });
    const zipPath = path.join(directory, `${name}.zip`);
    await writeZip(zipPath, entries);
    const zipStat = await fs.stat(zipPath);
    const bundle = { path: zipPath, size: zipStat.size, sha256: await hashFile(zipPath), kind: "source-bundle" };
    const primary = built[0] ?? bundle;
    const result = {
        version: 1,
        generatedAt: new Date().toISOString(),
        project: { name, ecosystem: project.ecosystem, language: project.language },
        directory,
        primary,
        artifacts: [...built, bundle],
        launcher: launcher ? { entry: launcher.entry, windows: "RUN.cmd", unix: "run.sh" } : null
    };
    await fs.writeFile(path.join(directory, "deliverable.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    return result;
}
