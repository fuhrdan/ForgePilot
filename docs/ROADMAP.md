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

## v0.2 — Autonomous repair loop ✅
- Feed failed action/test output back to the planner.
- Repair independent-verification failures.
- Bounded retry budget.
- Patch-oriented `replace_text` edits with ambiguity guard.
- Run history with explicit failure/repair/retry evidence.
- Per-task checkpoints and `--resume`.

## v0.3 — Repository intelligence ✅ (this release)
- Git-native and `.gitignore`-aware repository scanning.
- Project/language/framework detection.
- Read selected source files for planning context.
- Goal-aware, token-budgeted context builder.
- Automatic build/test/lint command hints.
- Git baseline fingerprinting.
- Git diff verifier and human-readable change summary.
- Unexpected-file detection and optional enforced change scope.
- Repository analysis CLI.

## v0.4 — Test-first agent
- Automatic test-command discovery promoted from hints to executable test gates.
- Existing-test inventory and targeted test selection.
- Test authoring mode with explicit test-change policy.
- Red/green evidence: prove the new test fails before implementation where practical.
- Coverage ingestion where available.
- Build/test gates required before success.
- Regression-test selection based on changed code.

## v0.5 — Disposable sandboxes
- Docker/Podman sandbox provider.
- Per-task CPU, RAM, disk, timeout, and network policy.
- Workspace snapshots and rollback.
- Dependency-install/network permissions.
- Host execution becomes an explicit alternate provider.

## v0.6 — Visual application verification
- Launch desktop/web applications.
- Screenshot capture.
- Vision-provider abstraction.
- Visual assertions and regression snapshots.
- Basic UI interaction evidence.

## v0.7 — Multi-agent roles
- Planner, Implementer, Debugger, Reviewer, Verifier.
- Evidence exchange rather than free-form agent chat.
- Reviewer can reject a patch but cannot silently modify it.
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
- Crash recovery and task queue.

## v1.0 — Verified autonomous software engineering
A task can be given as a goal plus repository. ForgePilot understands the repository, plans a bounded change, edits, builds, tests, launches when appropriate, visually/behaviorally verifies the result, repairs failures, and returns evidence-backed artifacts plus an attributable Git diff. Destructive/network actions remain permission-gated and success claims are backed by verifier evidence.
