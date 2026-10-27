import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

export function resolveSpawnCommand(command, args = [], {
    platform = process.platform,
    execPath = process.execPath,
    processEnv = process.env,
    existsSync = fs.existsSync
} = {}) {
    const original = { command, args: [...args] };
    if (platform !== "win32" || !["npm", "npx"].includes(command)) return original;

    const pathApi = path.win32;
    const cliName = command === "npm" ? "npm-cli.js" : "npx-cli.js";
    const candidates = [];

    // npm exposes its own JavaScript entry point while ForgePilot is launched
    // from an npm script. Reuse that trusted parent path when possible.
    const npmExecPath = String(processEnv?.npm_execpath ?? "");
    if (npmExecPath && /npm-cli\.js$/i.test(npmExecPath)) {
        candidates.push(command === "npm"
            ? npmExecPath
            : pathApi.join(pathApi.dirname(npmExecPath), "npx-cli.js"));
    }

    // Standard Node for Windows installs keep npm's JS CLI beside node.exe.
    candidates.push(pathApi.join(pathApi.dirname(execPath), "node_modules", "npm", "bin", cliName));

    const cliPath = candidates.find((candidate) => {
        try { return Boolean(candidate) && existsSync(candidate); }
        catch { return false; }
    });

    if (!cliPath) return original;
    return {
        command: execPath,
        args: [cliPath, ...args],
        displayCommand: command,
        displayArgs: [...args],
        shimResolved: true
    };
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

    const spawnSpec = resolveSpawnCommand(command, args);
    return runRaw(spawnSpec.command, spawnSpec.args, {
        cwd, timeoutMs, env,
        displayCommand: spawnSpec.displayCommand ?? command,
        displayArgs: spawnSpec.displayArgs ?? args,
        shimResolved: spawnSpec.shimResolved === true
    });
}

function runRaw(command, args, { cwd, timeoutMs = 300000, env = {}, displayCommand = command, displayArgs = args, shimResolved = false } = {}) {
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
            resolve({ command: displayCommand, args: displayArgs, resolvedCommand: shimResolved ? command : undefined, exitCode: -1, stdout, stderr: error.message, timedOut, durationMs: Date.now() - startedAt });
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
                command: displayCommand,
                args: displayArgs,
                resolvedCommand: shimResolved ? command : undefined,
                exitCode: code ?? -1,
                stdout,
                stderr,
                timedOut,
                durationMs: Date.now() - startedAt
            });
        });
    });
}
