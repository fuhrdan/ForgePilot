import { ForgePilotError } from "../core/errors.js";
import { COMPUTER_ACTION_TYPES } from "../computer/policy.js";

export const APPROVAL_CATEGORIES = Object.freeze([
    "file_write",
    "command_exec",
    "computer_control",
    "external_network",
    "secret_use",
    "sandbox_network"
]);

function normalizeList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String);
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export class ApprovalManager {
    constructor(config = {}, { grants = [], approveAll = false } = {}) {
        const raw = config === true ? {} : (config && typeof config === "object" ? config : {});
        this.required = new Set(normalizeList(raw.require));
        this.granted = new Set([...normalizeList(raw.grants), ...normalizeList(grants)]);
        this.approveAll = Boolean(approveAll || raw.approveAll === true);
        this.decisions = [];
        for (const category of [...this.required, ...this.granted]) {
            if (!APPROVAL_CATEGORIES.includes(category)) throw new ForgePilotError(`Unknown approval category: ${category}`, "INVALID_APPROVAL_CATEGORY");
        }
    }

    isRequired(category) { return this.required.has(category); }
    isGranted(category) { return this.approveAll || !this.isRequired(category) || this.granted.has(category); }

    require(category, detail = {}) {
        const passed = this.isGranted(category);
        const decision = { category, required: this.isRequired(category), granted: passed, ...detail };
        this.decisions.push(decision);
        if (!passed) throw new ForgePilotError(`Approval required for ${category}. Re-run with --approve ${category} or configure permissions.grants.`, "APPROVAL_REQUIRED");
        return decision;
    }

    checkAction(action, { secretStore = null } = {}) {
        if (["write_file", "replace_text"].includes(action?.type)) this.require("file_write", { actionType: action.type, path: action.path ?? null });
        if (action?.type === "run_command") {
            this.require("command_exec", { actionType: action.type, command: action.command ?? null });
            const hasSecret = secretStore && (secretStore.containsReference(action.args) || secretStore.containsReference(action.env));
            if (hasSecret) this.require("secret_use", { actionType: action.type });
        }
        if (COMPUTER_ACTION_TYPES.has(action?.type)) {
            this.require("computer_control", { actionType: action.type });
            if (action.type === "computer_navigate") {
                try {
                    const url = new URL(String(action.url ?? ""));
                    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) this.require("external_network", { actionType: action.type, origin: url.origin });
                } catch { /* computer policy handles malformed URLs */ }
            }
            if (secretStore && (action.secretRef || secretStore.containsReference(action.text))) this.require("secret_use", { actionType: action.type });
        }
    }

    snapshot() {
        return {
            required: [...this.required].sort(),
            granted: [...this.granted].sort(),
            approveAll: this.approveAll,
            decisions: [...this.decisions]
        };
    }
}
