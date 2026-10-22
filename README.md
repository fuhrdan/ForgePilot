# ForgePilot v0.3.0

**A local-first software-engineering agent that plans, edits, executes, repairs, and independently verifies its work.**

ForgePilot is intentionally built around evidence rather than agent confidence. A planner can propose code changes, but it cannot declare success. ForgePilot executes guarded actions, captures real process output, retries failures through a bounded repair loop, and runs an independent verifier.

v0.3 adds **repository intelligence**: ForgePilot now detects what kind of codebase it is operating on, honors repository ignore rules, selects relevant source context under a token budget, suggests likely build/test commands, and audits the files changed since the task began.

## Requirements

- Node.js 22+
- Git recommended
- Ollama optional for local-AI planning/debugging

No npm dependencies are required.

## Quick start

```powershell
npm test
node src/cli.js doctor
```

Analyze a repository before asking an AI to touch it:

```powershell
node src/cli.js analyze . --goal "fix authentication retry handling"
```

Run the deterministic hello example:

```powershell
node src/cli.js run examples/hello-task.json --workspace .\work\hello --apply
```

Run the autonomous-repair demonstration:

```powershell
node src/cli.js run examples/repair-task.json --workspace .\work\repair --apply --max-repairs 2
```

Use a local Ollama coding model:

```powershell
node src/cli.js run examples/ollama-task.json `
  --planner ollama `
  --model qwen2.5-coder:7b `
  --apply
```

Omit `--apply` to inspect the proposed plan without modifying the workspace.

## What's new in v0.3

### Repository scanner

When the workspace is a Git repository, ForgePilot asks Git for tracked and non-ignored untracked files:

```text
git ls-files -co --exclude-standard
```

That means the repository's real `.gitignore`, global excludes, and Git exclude rules are honored by Git itself. Outside a Git repository, ForgePilot uses a built-in `.gitignore`-aware scanner and always excludes common generated directories such as `.git`, `.forgepilot`, `node_modules`, `bin`, `obj`, `target`, `dist`, and `build`.

### Project detection

v0.3 recognizes:

- Node.js / JavaScript / TypeScript
- React, Next.js, Angular, Vue, Svelte, Express, Fastify, NestJS, Electron, Vite
- .NET / C#
- Maven / Java
- Gradle / Java/Kotlin
- Python
- Go
- Rust
- Godot / GDScript / C#
- generic C and C++ repositories

The detector also supplies likely build/test/lint commands from manifests and project structure.

### Token-budgeted context

ForgePilot no longer gives a planner only a flat filename list. It ranks repository files using:

- task-goal terms;
- source-directory relevance;
- manifests and project metadata;
- README/project documentation;
- test/source naming.

Selected text files are read under `maxContextTokens` (default: 6000 approximate tokens) and supplied to the planner. Source excerpts are transient and are **not persisted in the normal run report**.

Task JSON can override the budget:

```json
{
  "goal": "Fix session expiration handling",
  "maxContextTokens": 9000
}
```

The CLI analyzer can use a separate budget:

```powershell
node src/cli.js analyze C:\code\my-app `
  --goal "fix session expiration handling" `
  --max-context-tokens 4000
```

### Build/test hints

Examples:

```text
Node package.json scripts:
  test:  npm test
  build: npm run build
  lint:  npm run lint

.NET:
  build: dotnet build
  test:  dotnet test --no-build

Go:
  test:  go test ./...
  build: go build ./...

Rust:
  test:  cargo test
  build: cargo build
```

Hints are context, not automatically trusted commands. The planner still produces structured actions and the executor still enforces its command allowlist.

## Git change intelligence

At the beginning of an applied task, ForgePilot records a Git-aware baseline containing file fingerprints. After execution it compares the current repository against that baseline.

This distinguishes changes introduced during the task from dirty files that were already present when ForgePilot started.

Reports include:

```text
Changes since ForgePilot baseline: 3
Added / modified / deleted: 1 / 2 / 0
Unexpected changed files: 0
```

### `git_diff` verification

A task can explicitly require that only approved paths change:

```json
{
  "type": "git_diff",
  "allowedPaths": [
    "src/auth.js",
    "test/auth.test.js"
  ],
  "maxChangedFiles": 2
}
```

If ForgePilot or a program it launches also modifies `package.json`, `README.md`, or another unapproved file, this verification fails.

Directory scopes are supported:

```json
{
  "type": "git_diff",
  "allowedPaths": ["src/**", "test/**"]
}
```

Tasks may also enable automatic change-scope enforcement:

```json
{
  "enforceGitScope": true,
  "expectedChangePaths": ["src/generated/**"]
}
```

File-writing actions are automatically included in the expected change set. `expectedChangePaths` is for additional files a build step or generator is expected to modify.

Even when enforcement is disabled, ForgePilot records the Git change audit in its report.

## Guarded action model

Supported actions in v0.3:

### `write_file`

```json
{
  "type": "write_file",
  "path": "src/app.js",
  "content": "console.log('hello');\n"
}
```

### `replace_text`

```json
{
  "type": "replace_text",
  "path": "src/app.js",
  "find": "oldValue",
  "replace": "newValue",
  "expectedOccurrences": 1
}
```

The patch fails closed if the exact occurrence count does not match.

### `run_command`

```json
{
  "type": "run_command",
  "command": "node",
  "args": ["src/app.js"],
  "expectExitCode": 0
}
```

Commands execute with `shell: false`. Shell strings, pipes, redirection, and arbitrary executables are not accepted.

Current executable allowlist:

```text
node npm npx git python python3 pytest
go java javac mvn gradle dotnet cargo rustc godot godot4
```

## Independent verification

Supported checks:

- `file_exists`
- `file_contains`
- `command`
- `git_diff`

Example:

```json
{
  "verify": [
    { "type": "file_exists", "path": "src/app.js" },
    { "type": "file_contains", "path": "src/app.js", "text": "fixed" },
    {
      "type": "command",
      "command": "node",
      "args": ["src/app.js"],
      "expectExitCode": 0,
      "stdoutIncludes": "PASS"
    },
    {
      "type": "git_diff",
      "allowedPaths": ["src/app.js"]
    }
  ]
}
```

The verifier runs independently after implementation. A model saying "the fix worked" has no effect on the result.

## Autonomous repair loop

v0.2's repair engine remains intact:

```text
implement
   |
   v
execute --------------------+
   |                         |
   | failure evidence        |
   v                         |
debugger                     |
   |                         |
   v                         |
surgical repair              |
   |                         |
   +------> retry ------------+
   |
   v
independent verification
   |
   +-- failure --> bounded repair
   |
   v
PASS / FAIL with evidence
```

`--max-repairs` defaults to 2.

Checkpoints are written to:

```text
.forgepilot/state/<task-id>.json
```

Resume a failed task:

```powershell
node src/cli.js run task.json --workspace .\repo --resume --max-repairs 3 --apply
```

The Git baseline is stored in the checkpoint so a resumed task still measures changes against the state that existed before the original run.

## Repository analysis command

```text
forgepilot analyze [workspace] [--goal TEXT] [--max-context-tokens N]
```

Example output:

```text
ForgePilot v0.3.0 repository analysis
Workspace: C:\code\sample
Files: 184 (git)
Context: ~3962/6000 tokens across 7 files

Detected projects:
  - node: TypeScript/JavaScript [React, Vite]

Suggested commands:
  - test: npm test
  - build: npm run build

Selected AI context:
  - src/auth/session.ts (score 165)
  - package.json (score 95)
  - test/auth/session.test.ts (score 75)
```

## Safety model

ForgePilot v0.3 is intentionally conservative:

- plan-only unless `--apply` is supplied;
- workspace-relative paths cannot escape the selected workspace;
- commands are invoked without a shell;
- executable allowlist;
- repair retries are bounded;
- exact patch occurrence guard;
- planner cannot mark verification successful;
- source context is not persisted in normal run reports;
- Git scope verification can reject unrelated changes.

**Important:** v0.3 is not yet a hardened security sandbox. Allowed compilers/interpreters can execute repository code on the host. Disposable container/VM isolation is the v0.5 milestone.

## Architecture

```text
Goal / Task
    |
    v
Repository Intelligence
    |-- ignore-aware scanner
    |-- project detector
    |-- build/test hints
    |-- context ranker + token budget
    |
    v
Planner (scripted / Ollama)
    |
    v
Guarded Executor
    |
    +---- failure evidence ----> Debugger
    |                              |
    |                         bounded repair
    |                              |
    +<--------- retry -------------+
    |
    v
Independent Verifier
    |-- files
    |-- commands
    |-- Git change scope
    |
    v
Evidence Report + Checkpoint
```

See `docs/ARCHITECTURE.md` and `docs/REPOSITORY_INTELLIGENCE.md` for details.

## Roadmap

- **v0.1** — guarded local execution ✅
- **v0.2** — bounded autonomous repair ✅
- **v0.3** — repository intelligence ✅
- **v0.4** — test-first engineering agent
- **v0.5** — disposable Docker/Podman sandboxes
- **v0.6** — screenshot and visual verification
- **v0.7** — planner / implementer / debugger / reviewer / verifier roles
- **v0.8** — IDE/browser computer-use driver
- **v0.9** — Windows UI, installer, model profiles, security hardening
- **v1.0** — evidence-backed autonomous software engineer

## Tests

```powershell
npm test
```

v0.3.0 release validation: **18 tests passed, 0 failed**.

See `docs/VALIDATION.md`.

## License

MIT
