# ForgePilot v0.5.0

**A local-first software-engineering agent that proves its changes with executable evidence.**

ForgePilot combines repository intelligence, test-first engineering, bounded autonomous repair, independent verification, and now **disposable Docker/Podman execution**. In sandbox mode the real repository stays untouched until the entire engineering workflow passes.

## Requirements

- Node.js 22+
- Git recommended
- Docker or Podman for `--sandbox`
- Ollama optional for local-AI planning/debugging

ForgePilot has no npm runtime dependencies.

## Quick start

```powershell
npm test
node src/cli.js doctor
node src/cli.js analyze . --goal "improve sandbox execution"
```

Normal host-mode deterministic task:

```powershell
node src/cli.js run examples/hello-task.json --workspace .\work\hello --apply
```

Sandboxed task:

```powershell
node src/cli.js run task.json `
  --workspace .\repo `
  --sandbox `
  --sandbox-runtime auto `
  --sandbox-image node:22-bookworm `
  --apply
```

Pre-pull the image yourself, for example `docker pull node:22-bookworm`. ForgePilot defaults to `--pull never` so it does not silently download a new execution image.

## What v0.5 changes

The execution path is now:

```text
Original Repository
       |
       v
Disposable Copy
       |
       v
Docker / Podman
  |  network: none
  |  CPU / RAM / PID limits
  |  cap-drop ALL
  |  no-new-privileges
       |
       v
AUTHOR → RED → IMPLEMENT → GREEN → REGRESSION → BUILD
       |
       v
Independent Verification
       |
      PASS? ---------------- FAIL
       |                       |
       v                       v
Promote manifest delta       discard source changes
       |
       v
Original Repository
```

The host repository is not the container mount. The disposable copy is.

### Execution-provider boundary

All repository command execution uses the same provider:

- plan actions using `run_command`;
- RED test gate;
- GREEN/regression/build gates;
- verifier command checks;
- failed-step retries after repairs.

This prevents a containerized main action from being followed by an accidental host-side test or repair command.

### Default sandbox policy

```text
runtime       Docker or Podman
network       none
CPUs          2
memory        2g
PID limit     256
capabilities  ALL dropped
privileges    no-new-privileges
/tmp          bounded tmpfs
image pull    never
```

The original executable allowlist still applies inside the container.

### Rollback by non-promotion

ForgePilot snapshots the disposable tree, not the user's source tree. On PASS it promotes only the resulting added/modified/deleted files. On FAIL it simply does not promote them.

That is safer than trying to repair the real workspace with `git reset --hard` after a failed autonomous run.

### Artifact copy-out

Task configuration can request evidence or build products even when source changes fail verification:

```json
{
  "sandbox": {
    "enabled": true,
    "artifacts": [
      "dist/app.zip",
      "coverage/lcov.info"
    ]
  }
}
```

Those files are copied to:

```text
.forgepilot/artifacts/<task-id>/
```

### Sandbox configuration

```json
{
  "sandbox": {
    "enabled": true,
    "runtime": "auto",
    "image": "node:22-bookworm",
    "network": "none",
    "cpus": "2",
    "memory": "2g",
    "pidsLimit": 256,
    "pullPolicy": "never",
    "artifacts": ["dist/app.zip"]
  }
}
```

CLI flags override runtime/image selection:

```text
--sandbox
--sandbox-runtime auto|docker|podman
--sandbox-image IMAGE
--sandbox-keep
```

`--sandbox-keep` keeps a failed disposable workspace for debugging.

## Test-first engineering remains intact

v0.4's workflow still applies:

```text
AUTHOR regression test
   ↓
RED — must fail for the expected reason
   ↓
freeze RED-proven test
   ↓
IMPLEMENT
   ↓
GREEN
   ↓
REGRESSION
   ↓
BUILD
   ↓
Git scope + test integrity + independent checks
```

False-green tests, wrong RED failures, missing test runners, and attempts to weaken RED-proven tests fail closed.

## Repository intelligence

ForgePilot detects Node/TypeScript, .NET, Java/Maven/Gradle, Python, Go, Rust, Godot, and generic C/C++ projects. It performs ignore-aware scanning, ranks source context against the goal, discovers build/test commands, fingerprints Git state, and can reject unrelated file changes.

```powershell
node src/cli.js analyze C:\code\my-app `
  --goal "fix session expiration handling" `
  --max-context-tokens 4000
```

## Autonomous repair

Failures become structured evidence for a bounded repair loop:

```text
failure → diagnose → surgical patch → retry → verify
```

Use `--max-repairs N`. Host mode continues to support `--resume`; disposable sandbox resume is intentionally deferred in v0.5.

## Guarded actions

Supported implementation/repair actions:

- `write_file`
- `replace_text`
- `run_command`

Commands run without a shell and must be allowlisted:

```text
node npm npx git python python3 pytest
go java javac mvn gradle dotnet cargo rustc godot godot4
```

Docker/Podman are invoked only by ForgePilot's sandbox provider; they are not added to the agent's normal command allowlist.

## Validation

```text
v0.1   6 tests
v0.2  12 tests
v0.3  18 tests
v0.4  26 tests
v0.5  33 tests
```

The v0.5 suite covers container hardening arguments, command/cwd boundaries, disposable-workspace isolation, add/modify/delete promotion, artifact export without source promotion, and execution-provider routing.

The release environment used to build this ZIP does not have Docker or Podman installed. Therefore the container command path is tested with an injected runtime runner, and the CLI is verified to fail safely when sandboxing is requested without a runtime. The host test-first workflow is also exercised end-to-end.

See:

- `docs/SANDBOX.md`
- `docs/TEST_FIRST.md`
- `docs/REPOSITORY_INTELLIGENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`

## Next milestone — v0.6

**Visual Application Verification**: controlled application launch, screenshot capture, visual assertions, regression snapshots, and evidence-backed UI interaction.
