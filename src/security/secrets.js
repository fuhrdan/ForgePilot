import { ForgePilotError } from "../core/errors.js";

const SECRET_TEMPLATE = /\$\{\{\s*secret\.([A-Za-z0-9_.-]+)\s*\}\}/g;

function normalizeDefinitions(definitions = {}) {
    const out = new Map();
    for (const [alias, raw] of Object.entries(definitions ?? {})) {
        if (typeof raw === "string") out.set(alias, { env: raw });
        else if (raw && typeof raw === "object" && typeof raw.env === "string") out.set(alias, { env: raw.env });
        else throw new ForgePilotError(`Secret ${alias} must reference an environment variable.`, "INVALID_SECRET_CONFIG");
    }
    return out;
}

export class SecretStore {
    constructor(definitions = {}, { env = process.env } = {}) {
        this.definitions = normalizeDefinitions(definitions);
        this.env = env;
        this.resolved = new Map();
    }

    has(alias) { return this.definitions.has(String(alias)); }

    get(alias) {
        const key = String(alias);
        const definition = this.definitions.get(key);
        if (!definition) throw new ForgePilotError(`Unknown secret reference: ${key}`, "SECRET_NOT_DEFINED");
        if (this.resolved.has(key)) return this.resolved.get(key);
        const value = this.env[definition.env];
        if (value === undefined || value === "") throw new ForgePilotError(`Secret ${key} is unavailable; expected environment variable ${definition.env}.`, "SECRET_UNAVAILABLE");
        this.resolved.set(key, String(value));
        return String(value);
    }

    resolveValue(value) {
        if (value && typeof value === "object" && !Array.isArray(value) && value.secretRef) {
            return this.get(value.secretRef);
        }
        if (typeof value !== "string") return value;
        return value.replace(SECRET_TEMPLATE, (_match, alias) => this.get(alias));
    }

    containsReference(value) {
        if (value && typeof value === "object" && !Array.isArray(value) && value.secretRef) return true;
        return typeof value === "string" && /\$\{\{\s*secret\./.test(value);
    }

    resolveEnv(envMap = {}) {
        const out = {};
        for (const [key, value] of Object.entries(envMap ?? {})) out[key] = String(this.resolveValue(value));
        return out;
    }

    redactText(value) {
        let text = String(value ?? "");
        for (const secret of this.resolved.values()) {
            if (!secret) continue;
            text = text.split(secret).join("[REDACTED_SECRET]");
        }
        return text;
    }

    redactObject(value) {
        if (typeof value === "string") return this.redactText(value);
        if (Array.isArray(value)) return value.map((item) => this.redactObject(item));
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, this.redactObject(child)]));
    }

    summary() {
        return [...this.definitions.entries()].map(([alias, definition]) => ({
            alias,
            env: definition.env,
            available: this.env[definition.env] !== undefined && this.env[definition.env] !== ""
        }));
    }
}

export function secretReferences(value) {
    const found = new Set();
    function visit(item) {
        if (typeof item === "string") {
            for (const match of item.matchAll(SECRET_TEMPLATE)) found.add(match[1]);
            return;
        }
        if (Array.isArray(item)) return item.forEach(visit);
        if (!item || typeof item !== "object") return;
        if (item.secretRef) found.add(String(item.secretRef));
        Object.values(item).forEach(visit);
    }
    visit(value);
    return [...found];
}
