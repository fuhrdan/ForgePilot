import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { APPROVAL_CATEGORIES } from "../security/approvals.js";

function cleanText(value, max = 4000) {
    return String(value ?? "").replace(/\0/g, "").trim().slice(0, max);
}

function sanitizeApprovals(value) {
    const list = Array.isArray(value) ? value : ["file_write", "command_exec"];
    return [...new Set(list.map(String).filter((item) => APPROVAL_CATEGORIES.includes(item)))];
}

async function ensureProjectPath(value) {
    const resolved = path.resolve(cleanText(value, 4096));
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) throw new Error(`Project path is not an existing directory: ${resolved}`);
    return resolved;
}

export class DashboardProjectStore {
    constructor(rootWorkspace) {
        this.rootWorkspace = path.resolve(rootWorkspace ?? ".");
        this.filePath = path.join(this.rootWorkspace, ".forgepilot", "dashboard", "projects.json");
        this.projects = [];
        this.loaded = false;
    }

    async load() {
        if (this.loaded) return;
        try {
            const value = JSON.parse(await fs.readFile(this.filePath, "utf8"));
            this.projects = Array.isArray(value?.projects) ? value.projects : [];
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            this.projects = [];
        }
        this.loaded = true;
    }

    async persist() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify({ version: 1, projects: this.projects }, null, 2) + "\n", "utf8");
    }

    async list() {
        await this.load();
        return this.projects.map((item) => ({ ...item, approvals: [...(item.approvals ?? [])] }));
    }

    async get(id) {
        await this.load();
        const project = this.projects.find((item) => item.id === String(id));
        return project ? { ...project, approvals: [...(project.approvals ?? [])] } : null;
    }

    async save(input) {
        await this.load();
        const requestedId = cleanText(input?.id, 100);
        const index = requestedId ? this.projects.findIndex((item) => item.id === requestedId) : -1;
        const existing = index >= 0 ? this.projects[index] : null;
        const projectPath = await ensureProjectPath(input?.path ?? existing?.path);
        const name = cleanText(input?.name ?? existing?.name ?? path.basename(projectPath), 120);
        if (!name) throw new Error("Project name is required.");
        const now = new Date().toISOString();
        const project = {
            id: existing?.id ?? `project-${crypto.randomBytes(6).toString("hex")}`,
            name,
            path: projectPath,
            recipeId: cleanText(input?.recipeId ?? existing?.recipeId, 120) || null,
            autonomy: ["safe", "standard", "thorough"].includes(input?.autonomy ?? existing?.autonomy) ? (input?.autonomy ?? existing?.autonomy) : "standard",
            approvals: sanitizeApprovals(input?.approvals ?? existing?.approvals),
            sandbox: input?.sandbox === undefined ? Boolean(existing?.sandbox) : Boolean(input.sandbox),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now
        };
        if (index >= 0) this.projects[index] = project;
        else this.projects.push(project);
        await this.persist();
        return { ...project, approvals: [...project.approvals] };
    }

    async remove(id) {
        await this.load();
        const before = this.projects.length;
        this.projects = this.projects.filter((item) => item.id !== String(id));
        if (this.projects.length === before) return false;
        await this.persist();
        return true;
    }
}
