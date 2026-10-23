import path from "node:path";
import { ForgePilotError } from "../core/errors.js";
import { resolveInside } from "../core/paths.js";

export const COMPUTER_ACTION_TYPES = new Set([
    "computer_navigate",
    "computer_inspect",
    "computer_assert",
    "computer_click",
    "computer_type",
    "computer_key",
    "computer_wait",
    "computer_screenshot"
]);

function normalizeOrigin(value) {
    const parsed = new URL(value);
    return parsed.origin;
}

export function defaultAllowedOrigins() {
    return ["http://127.0.0.1", "http://localhost", "https://localhost"];
}

export function validateComputerAction(action, workspace, policy = {}) {
    if (!COMPUTER_ACTION_TYPES.has(action?.type)) {
        throw new ForgePilotError(`Unsupported computer action: ${action?.type}`, "COMPUTER_ACTION_BLOCKED");
    }

    if (action.type === "computer_navigate") {
        const rawUrl = String(action.url ?? "");
        let parsed;
        try { parsed = new URL(rawUrl); }
        catch { throw new ForgePilotError(`Invalid navigation URL: ${rawUrl}`, "COMPUTER_NAVIGATION_BLOCKED"); }

        if (parsed.protocol === "data:") {
            if (policy.allowDataUrls === true) return;
            throw new ForgePilotError("data: navigation requires computer.allowDataUrls=true.", "COMPUTER_NAVIGATION_BLOCKED");
        }

        if (parsed.protocol === "file:") {
            const filePath = decodeURIComponent(parsed.pathname);
            // On Windows URL pathname starts with /C:/...
            const normalized = process.platform === "win32" && /^\/[A-Za-z]:/.test(filePath) ? filePath.slice(1) : filePath;
            resolveInside(workspace, path.relative(workspace, normalized));
            return;
        }
        if (!["http:", "https:"].includes(parsed.protocol)) {
            throw new ForgePilotError(`Navigation scheme is not allowed: ${parsed.protocol}`, "COMPUTER_NAVIGATION_BLOCKED");
        }
        const allowed = Array.isArray(policy.allowedOrigins) && policy.allowedOrigins.length
            ? policy.allowedOrigins
            : defaultAllowedOrigins();
        const origin = normalizeOrigin(rawUrl);
        const permitted = allowed.some((candidate) => {
            try {
                const rule = new URL(candidate);
                if (rule.protocol !== parsed.protocol || rule.hostname !== parsed.hostname) return false;
                // An allowlist entry without an explicit port permits any port on that same host/scheme.
                return rule.port ? rule.port === parsed.port : true;
            } catch {
                return candidate === origin;
            }
        });
        if (!permitted) {
            throw new ForgePilotError(`Navigation origin is not allowlisted: ${origin}`, "COMPUTER_NAVIGATION_BLOCKED");
        }
    }

    if (action.type === "computer_assert") {
        const criteria = [action.role, action.name, action.value, action.contains].filter((item) => item !== undefined && item !== null && String(item) !== "");
        if (criteria.length === 0) throw new ForgePilotError("computer_assert requires role, name, value, or contains.", "COMPUTER_ACTION_BLOCKED");
    }

    if (["computer_click", "computer_type"].includes(action.type)) {
        const hasSelector = typeof action.selector === "string" && action.selector.length > 0;
        const hasPoint = Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y));
        if (!hasSelector && !(action.type === "computer_click" && hasPoint)) {
            throw new ForgePilotError(`${action.type} requires a selector${action.type === "computer_click" ? " or x/y coordinates" : ""}.`, "COMPUTER_ACTION_BLOCKED");
        }
        if (hasSelector && action.selector.length > 1000) throw new ForgePilotError("Computer selector is too long.", "COMPUTER_ACTION_BLOCKED");
    }

    if (action.type === "computer_type") {
        if (String(action.text ?? "").length > Number(policy.maxTypeChars ?? 20000)) {
            throw new ForgePilotError("computer_type text exceeds configured limit.", "COMPUTER_ACTION_BLOCKED");
        }
    }

    if (action.type === "computer_wait") {
        const ms = Number(action.ms ?? 0);
        if (!Number.isFinite(ms) || ms < 0 || ms > Number(policy.maxWaitMs ?? 30000)) {
            throw new ForgePilotError("computer_wait exceeds configured limit.", "COMPUTER_ACTION_BLOCKED");
        }
    }
}

export function traceSafeAction(action) {
    if (action.type !== "computer_type") return { ...action };
    const text = String(action.text ?? "");
    return {
        ...action,
        text: action.secret === false ? text : "[REDACTED]",
        textLength: text.length,
        secret: action.secret !== false
    };
}
