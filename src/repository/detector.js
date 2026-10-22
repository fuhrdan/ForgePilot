import fs from "node:fs/promises";
import path from "node:path";
import { resolveInside } from "../core/paths.js";

async function readJson(workspace, relative) {
    try { return JSON.parse(await fs.readFile(resolveInside(workspace, relative), "utf8")); }
    catch { return null; }
}

function has(files, name) {
    return files.some((file) => file === name || file.endsWith(`/${name}`));
}

function anyExt(files, extensions) {
    return files.some((file) => extensions.some((ext) => file.toLowerCase().endsWith(ext)));
}

function nodeFrameworks(pkg) {
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    const names = [];
    const candidates = [
        ["next", "Next.js"], ["react", "React"], ["@angular/core", "Angular"],
        ["vue", "Vue"], ["svelte", "Svelte"], ["express", "Express"],
        ["fastify", "Fastify"], ["nestjs", "NestJS"], ["@nestjs/core", "NestJS"],
        ["electron", "Electron"], ["vite", "Vite"], ["typescript", "TypeScript"]
    ];
    for (const [dep, label] of candidates) if (deps[dep] && !names.includes(label)) names.push(label);
    return names;
}

export async function detectProjects(workspace, files) {
    const projects = [];

    if (has(files, "package.json")) {
        const pkg = await readJson(workspace, "package.json");
        const scripts = pkg?.scripts ?? {};
        const hints = [];
        if (scripts.test) hints.push({ kind: "test", command: "npm", args: ["test"] });
        if (scripts.build) hints.push({ kind: "build", command: "npm", args: ["run", "build"] });
        if (scripts.lint) hints.push({ kind: "lint", command: "npm", args: ["run", "lint"] });
        projects.push({
            ecosystem: "node",
            language: depsLanguage(pkg, files),
            root: ".",
            manifests: ["package.json", ...(has(files, "package-lock.json") ? ["package-lock.json"] : [])],
            frameworks: nodeFrameworks(pkg),
            commands: hints,
            name: pkg?.name ?? null
        });
    }

    if (files.some((f) => f.endsWith(".sln")) || files.some((f) => f.endsWith(".csproj"))) {
        projects.push({ ecosystem: "dotnet", language: "C#", root: ".", manifests: files.filter((f) => f.endsWith(".sln") || f.endsWith(".csproj")).slice(0, 20), frameworks: [], commands: [
            { kind: "build", command: "dotnet", args: ["build"] },
            { kind: "test", command: "dotnet", args: ["test", "--no-build"] }
        ] });
    }

    if (has(files, "pom.xml")) {
        projects.push({ ecosystem: "maven", language: "Java", root: ".", manifests: ["pom.xml"], frameworks: [], commands: [
            { kind: "test", command: "mvn", args: ["test"] }, { kind: "build", command: "mvn", args: ["package", "-DskipTests"] }
        ] });
    } else if (has(files, "build.gradle") || has(files, "build.gradle.kts")) {
        projects.push({ ecosystem: "gradle", language: anyExt(files, [".kt", ".kts"]) ? "Kotlin/Java" : "Java", root: ".", manifests: [has(files, "build.gradle.kts") ? "build.gradle.kts" : "build.gradle"], frameworks: [], commands: [
            { kind: "test", command: "gradle", args: ["test"] }, { kind: "build", command: "gradle", args: ["build"] }
        ] });
    }

    if (has(files, "pyproject.toml") || has(files, "requirements.txt") || anyExt(files, [".py"])) {
        projects.push({ ecosystem: "python", language: "Python", root: ".", manifests: ["pyproject.toml", "requirements.txt"].filter((x) => has(files, x)), frameworks: [], commands: [
            { kind: "test", command: "pytest", args: [] }
        ] });
    }

    if (has(files, "go.mod")) {
        projects.push({ ecosystem: "go", language: "Go", root: ".", manifests: ["go.mod"], frameworks: [], commands: [
            { kind: "test", command: "go", args: ["test", "./..."] }, { kind: "build", command: "go", args: ["build", "./..."] }
        ] });
    }

    if (has(files, "Cargo.toml")) {
        projects.push({ ecosystem: "rust", language: "Rust", root: ".", manifests: ["Cargo.toml"], frameworks: [], commands: [
            { kind: "test", command: "cargo", args: ["test"] }, { kind: "build", command: "cargo", args: ["build"] }
        ] });
    }

    if (has(files, "project.godot")) {
        projects.push({ ecosystem: "godot", language: anyExt(files, [".cs"]) ? "GDScript/C#" : "GDScript", root: ".", manifests: ["project.godot"], frameworks: ["Godot"], commands: [
            { kind: "validate", command: "godot", args: ["--headless", "--path", ".", "--editor", "--quit"] }
        ] });
    }

    if (projects.length === 0) {
        let language = "Unknown";
        if (anyExt(files, [".c", ".h"])) language = "C";
        else if (anyExt(files, [".cpp", ".cc", ".cxx", ".hpp"])) language = "C++";
        else if (anyExt(files, [".java"])) language = "Java";
        projects.push({ ecosystem: "generic", language, root: ".", manifests: [], frameworks: [], commands: [] });
    }

    return projects;
}

function depsLanguage(pkg, files) {
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    return deps.typescript || anyExt(files, [".ts", ".tsx"]) ? "TypeScript/JavaScript" : "JavaScript";
}
