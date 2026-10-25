import { spawn } from "node:child_process";
import { ForgePilotError } from "./errors.js";

export const DEFAULT_ALLOWED_COMMANDS = new Set([
    "node", "npm", "npx", "git", "python", "python3", "pytest",
    "go", "java", "javac", "mvn", "gradle", "dotnet", "cargo", "rustc", "godot", "godot4"
]);

export async function commandExists(command) {
    const probe = process.platform === "win32" ? "where" : "which";
    const result = await runRaw(probe, [command], { timeoutMs: 5000 });
    return result.exitCode === 0;
}

export async function runCommand({
    command,
    args = [],
    cwd,
    timeoutMs = 300000,
    allowedCommands = DEFAULT_ALLOWED_COMMANDS,
    env = {}
}) {
    if (!allowedCommands.has(command)) {
        throw new ForgePilotError(`Command is not allowlisted: ${command}`, "COMMAND_BLOCKED");
    }

    return runRaw(command, args, { cwd, timeoutMs, env });
}

function runRaw(command, args, { cwd, timeoutMs = 300000, env = {} } = {}) {
    return new Promise((resolve) => {
        const startedAt = Date.now();
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        let child;
        try {
            const childEnv = { ...process.env, ...env };
            // Do not leak Node's parent test-runner control channel into nested project test runs.
            delete childEnv.NODE_TEST_CONTEXT;
            child = spawn(command, args, {
                cwd,
                shell: false,
                windowsHide: true,
                env: childEnv
            });
        } catch (error) {
            resolve({ command, args, exitCode: -1, stdout, stderr: error.message, timedOut, durationMs: Date.now() - startedAt });
            return;
        }

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("error", (error) => { stderr += error.message; });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({
                command,
                args,
                exitCode: code ?? -1,
                stdout,
                stderr,
                timedOut,
                durationMs: Date.now() - startedAt
            });
        });
    });
}
