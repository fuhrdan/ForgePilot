# ForgePilot v0.1.0

**An AI software-engineering orchestrator that must prove its work.**

ForgePilot is a local-first experiment in moving from "LLM writes code" to:

`goal → plan → guarded actions → build/run → independent verification → evidence`

v0.1 deliberately starts small. It can use a local Ollama model to produce a structured
software-engineering plan, execute that plan inside a selected workspace, and verify the
result using checks that are run independently of the planner.

## Requirements

- Node.js 22+
- Git
- Optional: Ollama plus a coding model such as `qwen2.5-coder:7b`
- Optional language toolchains depending on the repository being worked on

No npm dependencies are required for v0.1.

## Install locally

```bash
npm install
npm link
forgepilot doctor
```

On Windows PowerShell the same commands work once Node.js is installed and available on PATH.

## First verified run

From the ForgePilot directory:

```bash
node src/cli.js run examples/hello-task.json --apply
```

The example writes `hello.js`, executes it, and then independently verifies that the file
exists, contains the expected text, and produces the expected output.

Without `--apply`, ForgePilot only plans:

```bash
node src/cli.js run examples/hello-task.json
```

## Use a local Ollama model

Make sure Ollama is running and that the model exists locally, then:

```bash
node src/cli.js run examples/ollama-task.json --planner ollama --model qwen2.5-coder:7b
```

Inspect the plan/report first. To allow the generated actions to run:

```bash
node src/cli.js run examples/ollama-task.json --planner ollama --model qwen2.5-coder:7b --apply
```

## Work on an existing repository

```bash
node src/cli.js clone https://github.com/OWNER/REPO.git ./work/myrepo
```

Then point a task's `workspace` field at `./work/myrepo`, or override it:

```bash
node src/cli.js run my-task.json --workspace ./work/myrepo --planner ollama --model qwen2.5-coder:7b
```

## Safety model in v0.1

ForgePilot does **not** give an LLM an unrestricted shell.

- AI execution is plan-only unless `--apply` is supplied.
- Commands are spawned directly, not via a shell.
- Only an explicit executable allowlist is permitted.
- File paths are resolved and rejected if they escape the workspace.
- The v0.1 planner is told not to commit or push.
- Reports preserve action and verification evidence.

This is an early sandboxing layer, not a hardened security boundary. v0.5 is planned to add
disposable container/VM providers with resource and network policies.

## Task format

A scripted task looks like this:

```json
{
  "goal": "Create a hello program",
  "planner": "scripted",
  "workspace": "./hello-workspace",
  "actions": [
    { "type": "write_file", "path": "hello.js", "content": "console.log(\"hello\");\n" },
    { "type": "run_command", "command": "node", "args": ["hello.js"], "expectExitCode": 0 }
  ],
  "verify": [
    { "type": "file_exists", "path": "hello.js" },
    { "type": "command", "command": "node", "args": ["hello.js"], "stdoutIncludes": "hello" }
  ]
}
```

For an Ollama task, supply the goal and planner; the model generates the structured actions
and checks.

## Commands

```text
forgepilot init <workspace>
forgepilot doctor
forgepilot clone <git-url> <workspace>
forgepilot run <task.json> [--workspace PATH]
                           [--planner scripted|ollama]
                           [--model MODEL]
                           [--ollama-url URL]
                           [--apply]
```

## What v0.1 proves

The important feature is not code generation itself. It is separation of **claim** from
**evidence**. The planner proposes work; the executor performs guarded actions; the verifier
checks the resulting repository state and program behavior.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the path to v1.0.
