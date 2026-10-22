import path from "node:path";
import { DEFAULT_ALLOWED_COMMANDS, commandExists, runCommand } from "../core/command.js";
import { ForgePilotError } from "../core/errors.js";

function normalizeRuntime(value) {
    const runtime = String(value ?? "auto").toLowerCase();
    if (!["auto", "docker", "podman"].includes(runtime)) {
        throw new ForgePilotError(`Unsupported sandbox runtime: ${runtime}`, "INVALID_SANDBOX_RUNTIME");
    }
    return runtime;
}

export async function detectContainerRuntime(preferred = "auto") {
    const requested = normalizeRuntime(preferred);
    const candidates = requested === "auto" ? ["docker", "podman"] : [requested];
    for (const runtime of candidates) {
        if (await commandExists(runtime)) return { available: true, runtime };
    }
    return { available: false, runtime: requested === "auto" ? null : requested };
}

export class HostExecutionProvider {
    constructor() {
        this.kind = "host";
        this.runtime = null;
    }

    describe() {
        return { kind: this.kind, isolated: false };
    }

    async run(spec) {
        return runCommand(spec);
    }
}

export class ContainerExecutionProvider {
    constructor({
        runtime,
        workspaceRoot,
        image = "node:22-bookworm",
        network = "none",
        cpus = "2",
        memory = "2g",
        pidsLimit = 256,
        pullPolicy = "never",
        runner = runCommand
    }) {
        if (!["docker", "podman"].includes(runtime)) throw new ForgePilotError("ContainerExecutionProvider requires docker or podman.", "INVALID_SANDBOX_RUNTIME");
        this.kind = "container";
        this.runtime = runtime;
        this.workspaceRoot = path.resolve(workspaceRoot);
        this.image = image;
        this.network = network;
        this.cpus = String(cpus);
        this.memory = String(memory);
        this.pidsLimit = Number(pidsLimit);
        this.pullPolicy = pullPolicy;
        this.runner = runner;
    }

    describe() {
        return {
            kind: this.kind,
            isolated: true,
            runtime: this.runtime,
            image: this.image,
            network: this.network,
            cpus: this.cpus,
            memory: this.memory,
            pidsLimit: this.pidsLimit,
            pullPolicy: this.pullPolicy
        };
    }

    async run({ command, args = [], cwd, timeoutMs = 120000, allowedCommands = DEFAULT_ALLOWED_COMMANDS, env = {} }) {
        if (!allowedCommands.has(command)) throw new ForgePilotError(`Command is not allowlisted: ${command}`, "COMMAND_BLOCKED");
        const absoluteCwd = path.resolve(cwd ?? this.workspaceRoot);
        const relativeCwd = path.relative(this.workspaceRoot, absoluteCwd);
        if (relativeCwd.startsWith("..") || path.isAbsolute(relativeCwd)) {
            throw new ForgePilotError("Sandbox command cwd escaped the disposable workspace.", "SANDBOX_CWD_ESCAPE");
        }
        const containerCwd = relativeCwd ? `/workspace/${relativeCwd.split(path.sep).join("/")}` : "/workspace";
        const mountSource = this.workspaceRoot;
        const runtimeArgs = ["run", "--rm", "--pull", this.pullPolicy, "--network", this.network,
            "--cpus", this.cpus, "--memory", this.memory, "--pids-limit", String(this.pidsLimit),
            "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
            "--tmpfs", "/tmp:rw,nosuid,size=512m",
            "--mount", `type=bind,source=${mountSource},target=/workspace`,
            "--workdir", containerCwd,
            "--env", "HOME=/tmp/home",
            "--env", "npm_config_cache=/tmp/npm-cache"];
        for (const [key, value] of Object.entries(env)) runtimeArgs.push("--env", `${key}=${value}`);
        runtimeArgs.push(this.image, command, ...args.map(String));

        const result = await this.runner({
            command: this.runtime,
            args: runtimeArgs,
            cwd: this.workspaceRoot,
            timeoutMs,
            allowedCommands: new Set([this.runtime])
        });
        return {
            ...result,
            command,
            args,
            sandbox: { runtime: this.runtime, image: this.image, containerCwd }
        };
    }
}

export async function createExecutionProvider({ enabled = false, runtime = "auto", workspaceRoot, ...limits } = {}) {
    if (!enabled) return new HostExecutionProvider();
    const detected = await detectContainerRuntime(runtime);
    if (!detected.available) {
        throw new ForgePilotError(`Sandbox requested, but ${runtime === "auto" ? "neither Docker nor Podman is" : `${runtime} is not`} available.`, "SANDBOX_RUNTIME_UNAVAILABLE");
    }
    return new ContainerExecutionProvider({ runtime: detected.runtime, workspaceRoot, ...limits });
}
