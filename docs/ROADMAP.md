# ForgePilot Roadmap: v0.1 → v1.0

## v0.1 — Guarded local execution ✅
- Node 22 CLI.
- Scripted and Ollama planners.
- Workspace-constrained file writes.
- Shell-free, executable-allowlisted command execution.
- Plan-only default; explicit `--apply` required.
- Independent file/command verification.
- Git status capture.
- JSON + Markdown run reports.
- Doctor and clone commands.

## v0.2 — Autonomous repair loop ✅ (this release)
- Feed failed action/test output back to the planner.
- Repair independent-verification failures.
- Bounded retry budget.
- Patch-oriented `replace_text` edits with ambiguity guard.
- Run history with explicit failure/repair/retry evidence.
- Per-task checkpoints and `--resume`.

## v0.3 — Repository intelligence
- Project/language/framework detection.
- Read selected source files for planning context.
- `.gitignore` / ignore-aware repository scanner.
- Token-budgeted context builder.
- Git diff verifier and human-readable change summary.
- Automatic build/test command hints based on project structure.

## v0.4 — Test-first agent
- Automatic test-command discovery.
- Test authoring mode.
- Coverage ingestion where available.
- Build/test gates before success.

## v0.5 — Disposable sandboxes
- Docker/Podman sandbox provider.
- Per-task CPU, RAM, disk, timeout, and network policy.
- Workspace snapshots and rollback.
- Host execution becomes an explicit alternate provider.

## v0.6 — Visual application verification
- Launch desktop/web applications.
- Screenshot capture.
- Vision-provider abstraction.
- Visual assertions and regression snapshots.

## v0.7 — Multi-agent roles
- Planner, Implementer, Debugger, Reviewer, Verifier.
- Evidence exchange rather than free-form agent chat.
- Independent verifier cannot modify the workspace.

## v0.8 — IDE / browser computer use
- Computer-use driver abstraction.
- VS Code/browser automation.
- Mouse/keyboard workflows when CLI tooling is insufficient.
- Recorded interaction trace.

## v0.9 — Product hardening
- Windows installer.
- Local web dashboard.
- Model profiles and hardware-aware model selection.
- Secrets store and permission controls.
- Signed run manifests / provenance.

## v1.0 — Verified autonomous software engineering
A task can be given as a goal plus repository. ForgePilot plans, edits, builds, tests, launches when appropriate, visually/behaviorally verifies the result, repairs failures, and returns evidence-backed artifacts and a clean Git diff. Destructive/network actions remain permission-gated and all success claims are backed by verifier evidence.
