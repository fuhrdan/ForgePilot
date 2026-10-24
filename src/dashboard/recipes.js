import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { APPROVAL_CATEGORIES } from "../security/approvals.js";

const BUILTIN_RECIPES = Object.freeze([
    {
        id: "fix-bug-test-first",
        name: "Fix bug — test first",
        description: "Reproduce the defect with a regression test, make the smallest safe fix, then run targeted and broader verification.",
        builtin: true,
        autonomy: "standard",
        approvals: ["file_write", "command_exec"],
        sandbox: false,
        prefix: "Fix the described bug. Reproduce it with a failing regression test first when the repository has a usable test system. Make the smallest safe implementation change.",
        suffix: "Run relevant targeted tests, broader regression tests/build when available, and verify unrelated files were not changed."
    },
    {
        id: "add-feature",
        name: "Add feature",
        description: "Implement a feature with repository-aware tests, review, build, and scope verification.",
        builtin: true,
        autonomy: "standard",
        approvals: ["file_write", "command_exec"],
        sandbox: false,
        prefix: "Implement the requested feature. Inspect the existing architecture and conventions before editing. Add or update tests before implementation when practical.",
        suffix: "Keep the change focused, run the relevant tests/build, review the result, and verify unrelated files were not changed."
    },
    {
        id: "review-repository",
        name: "Review repository",
        description: "Read-only architecture/code review with evidence and prioritized findings.",
        builtin: true,
        autonomy: "safe",
        approvals: ["command_exec"],
        sandbox: false,
        prefix: "Perform a read-only repository review. Do not modify source files. Inspect architecture, tests, build configuration, reliability, security, and maintainability as relevant to the goal.",
        suffix: "Return prioritized findings with concrete file references and verification evidence. Do not make repository changes."
    },
    {
        id: "prepare-release",
        name: "Prepare release",
        description: "Run release checks, fix bounded issues, and prepare local release artifacts without publishing externally.",
        builtin: true,
        autonomy: "thorough",
        approvals: ["file_write", "command_exec"],
        sandbox: false,
        prefix: "Prepare this repository for a local release. Inspect versioning, changelog/release notes, tests, build steps, and packaging conventions. Do not publish or push externally.",
        suffix: "Run the complete locally available verification suite, produce release artifacts when supported, and verify Git scope before reporting readiness."
    }
]);

function cleanText(value, max = 4000) {
    return String(value ?? "").replace(/\0/g, "").trim().slice(0, max);
}

function sanitizeApprovals(value) {
    const list = Array.isArray(value) ? value : [];
    return [...new Set(list.map(String).filter((item) => APPROVAL_CATEGORIES.includes(item)))];
}

function normalizeCustom(input, existing = null) {
    const name = cleanText(input?.name, 120);
    if (!name) throw new Error("Recipe name is required.");
    const prefix = cleanText(input?.prefix, 6000);
    const suffix = cleanText(input?.suffix, 6000);
    if (!prefix && !suffix) throw new Error("Recipe must include a prefix or suffix.");
    const autonomy = ["safe", "standard", "thorough"].includes(input?.autonomy) ? input.autonomy : "standard";
    const now = new Date().toISOString();
    return {
        id: existing?.id ?? `custom-${crypto.randomBytes(6).toString("hex")}`,
        name,
        description: cleanText(input?.description, 500),
        builtin: false,
        autonomy,
        approvals: sanitizeApprovals(input?.approvals),
        sandbox: Boolean(input?.sandbox),
        prefix,
        suffix,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
    };
}

export function applyRecipe(recipe, goal) {
    const cleanGoal = cleanText(goal, 12000);
    if (!recipe) return cleanGoal;
    return [recipe.prefix, cleanGoal, recipe.suffix].map((value) => cleanText(value, 12000)).filter(Boolean).join("\n\n");
}

export class DashboardRecipeStore {
    constructor(rootWorkspace) {
        this.rootWorkspace = path.resolve(rootWorkspace ?? ".");
        this.filePath = path.join(this.rootWorkspace, ".forgepilot", "dashboard", "recipes.json");
        this.custom = [];
        this.loaded = false;
    }

    async load() {
        if (this.loaded) return;
        try {
            const value = JSON.parse(await fs.readFile(this.filePath, "utf8"));
            this.custom = Array.isArray(value?.recipes) ? value.recipes.filter((item) => item && item.builtin !== true) : [];
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            this.custom = [];
        }
        this.loaded = true;
    }

    async persist() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify({ version: 1, recipes: this.custom }, null, 2) + "\n", "utf8");
    }

    async list() {
        await this.load();
        return [...BUILTIN_RECIPES.map((item) => ({ ...item })), ...this.custom.map((item) => ({ ...item }))];
    }

    async get(id) {
        const all = await this.list();
        return all.find((item) => item.id === String(id)) ?? null;
    }

    async save(input) {
        await this.load();
        const requestedId = cleanText(input?.id, 100);
        if (BUILTIN_RECIPES.some((item) => item.id === requestedId)) throw new Error("Built-in recipes cannot be replaced.");
        const index = requestedId ? this.custom.findIndex((item) => item.id === requestedId) : -1;
        const recipe = normalizeCustom(input, index >= 0 ? this.custom[index] : null);
        if (index >= 0) this.custom[index] = recipe;
        else this.custom.push(recipe);
        await this.persist();
        return { ...recipe };
    }

    async remove(id) {
        await this.load();
        if (BUILTIN_RECIPES.some((item) => item.id === String(id))) throw new Error("Built-in recipes cannot be deleted.");
        const before = this.custom.length;
        this.custom = this.custom.filter((item) => item.id !== String(id));
        if (this.custom.length === before) return false;
        await this.persist();
        return true;
    }
}

export { BUILTIN_RECIPES };
