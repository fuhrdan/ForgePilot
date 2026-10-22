import path from "node:path";
import { ForgePilotError } from "./errors.js";

export function resolveInside(root, candidate = ".") {
    const absoluteRoot = path.resolve(root);
    const resolved = path.resolve(absoluteRoot, candidate);
    const relative = path.relative(absoluteRoot, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new ForgePilotError(`Path escapes workspace: ${candidate}`, "PATH_ESCAPE");
    }

    return resolved;
}
