# ForgePilot Roadmap: v0.1 → v1.0

## v0.1 — Guarded local execution ✅
- Node 22 CLI, Scripted/Ollama planners, guarded workspace actions.
- Shell-free allowlisted command execution.
- Independent verification and evidence reports.

## v0.2 — Autonomous repair loop ✅
- Failure evidence → bounded repair → retry.
- Surgical `replace_text`, checkpoints, and host-mode `--resume`.

## v0.3 — Repository intelligence ✅
- Ignore-aware scanning and project/framework detection.
- Goal-aware source context and build/test hints.
- Git baseline/diff attribution and scope verification.

## v0.4 — Test-first engineering agent ✅
- Test inventory and targeted selection.
- AUTHOR → RED → IMPLEMENT → GREEN → REGRESSION → BUILD gates.
- False-green/wrong-RED protection and immutable RED-proven tests.
- Coverage artifact ingestion.

## v0.5 — Disposable sandboxes ✅ (this release)
- Host/container execution-provider abstraction.
- Docker/Podman runtime detection.
- Disposable repository copy for sandboxed APPLY runs.
- Default no-network policy plus CPU/RAM/PID limits.
- Drop Linux capabilities + no-new-privileges.
- No implicit image pulls (`--pull never` by default).
- PASS-only manifest promotion to the original workspace.
- Failed-run rollback by discarding the disposable copy.
- Explicit artifact copy-out independent of source promotion.
- Sandbox metadata in evidence reports.

## v0.6 — Visual application verification
- Launch desktop/web applications from controlled execution environments.
- Screenshot capture and vision-provider abstraction.
- Visual assertions and regression snapshots.
- Basic UI interaction evidence.

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
A task can be given as a goal plus repository. ForgePilot understands the repository, proves a regression where practical, implements a bounded change in a controlled environment, builds, tests, launches when appropriate, visually/behaviorally verifies the result, repairs failures, and returns evidence-backed artifacts plus an attributable Git diff. Destructive/network actions remain permission-gated and success claims are backed by verifier evidence.
