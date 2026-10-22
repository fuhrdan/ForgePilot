# ForgePilot Roadmap: v0.1 → v1.0

## v0.1 — Guarded local execution ✅
- Node 22 CLI, Scripted/Ollama planners, guarded workspace actions.
- Shell-free allowlisted command execution.
- Independent verification and evidence reports.

## v0.2 — Autonomous repair loop ✅
- Failure evidence → bounded repair → retry.
- Surgical `replace_text`, checkpoints, and `--resume`.

## v0.3 — Repository intelligence ✅
- Ignore-aware scanning and project/framework detection.
- Goal-aware source context and build/test hints.
- Git baseline/diff attribution and scope verification.

## v0.4 — Test-first engineering agent ✅ (this release)
- Test inventory and goal/source-aware targeted selection.
- Executable test/build gates derived from repository metadata.
- Test-only authoring phase before implementation.
- RED gate with false-green, infrastructure-failure, and expected-failure-signature checks.
- RED-proven test immutability through implementation/repair.
- GREEN, regression, and build gates before success.
- Gate failures enter the bounded repair loop.
- LCOV / coverage-summary ingestion when available.

## v0.5 — Disposable sandboxes
- Docker/Podman sandbox provider.
- Per-task CPU, RAM, disk, timeout, and network policy.
- Workspace snapshots and rollback.
- Dependency-install/network permissions.
- Host execution becomes an explicit alternate provider.

## v0.6 — Visual application verification
- Launch desktop/web applications.
- Screenshot capture and vision-provider abstraction.
- Visual assertions, regression snapshots, and basic UI interaction evidence.

## v0.7 — Multi-agent roles
- Planner, Implementer, Debugger, Reviewer, Verifier.
- Evidence exchange rather than free-form agent chat.
- Reviewer can reject a patch but cannot silently modify it.

## v0.8 — IDE / browser computer use
- Computer-use driver abstraction.
- VS Code/browser automation.
- Mouse/keyboard workflows and recorded interaction trace.

## v0.9 — Product hardening
- Windows installer and local web dashboard.
- Model profiles/hardware-aware selection.
- Secrets/permission controls, signed provenance, crash recovery, task queue.

## v1.0 — Verified autonomous software engineering
A task can be given as a goal plus repository. ForgePilot understands the repository, proves a regression where practical, implements a bounded change, builds, tests, launches when appropriate, visually/behaviorally verifies the result, repairs failures, and returns evidence-backed artifacts plus an attributable Git diff. Destructive/network actions remain permission-gated and success claims are backed by verifier evidence.
