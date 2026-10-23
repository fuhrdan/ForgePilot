const READ_ONLY_ROLES = new Set(["planner", "reviewer", "verifier"]);
const MUTATING_ROLES = new Set(["implementer", "debugger"]);

export function roleCapabilities(role) {
    const normalized = String(role ?? "").toLowerCase();
    return {
        role: normalized,
        readOnly: READ_ONLY_ROLES.has(normalized),
        mayProposeMutations: MUTATING_ROLES.has(normalized)
    };
}

function mutationPayloads(value, trail = "root", found = []) {
    if (!value || typeof value !== "object") return found;
    if (Array.isArray(value)) {
        value.forEach((item, index) => mutationPayloads(item, `${trail}[${index}]`, found));
        return found;
    }

    for (const [key, child] of Object.entries(value)) {
        const lower = key.toLowerCase();
        if (["actions", "patches", "writes", "commands", "mutations"].includes(lower) && Array.isArray(child) && child.length > 0) {
            found.push(`${trail}.${key}`);
        }
        if (["command", "patch", "replacement", "replace", "content"].includes(lower) && child !== null && child !== undefined && child !== "") {
            found.push(`${trail}.${key}`);
        }
        if (lower === "type" && ["write_file", "replace_text", "run_command"].includes(String(child))) {
            found.push(`${trail}.${key}`);
        }
        mutationPayloads(child, `${trail}.${key}`, found);
    }
    return found;
}

export function enforceRolePolicy(role, payload) {
    const capabilities = roleCapabilities(role);
    const violations = [];
    if (capabilities.readOnly) {
        const mutationFields = mutationPayloads(payload);
        for (const field of mutationFields) {
            violations.push({ role: capabilities.role, rule: "read_only", field, message: `${capabilities.role} role attempted to return mutation instructions via ${field}.` });
        }
    }
    return { passed: violations.length === 0, role: capabilities.role, violations };
}

export const ROLE_CAPABILITIES = Object.freeze({
    planner: roleCapabilities("planner"),
    implementer: roleCapabilities("implementer"),
    debugger: roleCapabilities("debugger"),
    reviewer: roleCapabilities("reviewer"),
    verifier: roleCapabilities("verifier")
});
