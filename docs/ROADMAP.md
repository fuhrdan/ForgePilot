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

## v0.5 — Disposable sandboxes ✅
- Host/container execution-provider abstraction.
- Docker/Podman runtime detection and default no-network policy.
- CPU/RAM/PID limits, dropped capabilities, no-new-privileges.
- PASS-only manifest promotion and explicit artifact copy-out.

## v0.6 — Visual application verification ✅
- Command-driven PNG screenshot capture through the execution-provider boundary.
- Frozen visual baselines with deterministic pixel/region assertions.
- Visual failures feed the bounded repair/reverify loop.
- Optional local Ollama multimodal vision-provider abstraction.

## v0.7 — Multi-agent engineering roles ✅ (this release)
- Separate Planner, Implementer, Debugger, Reviewer, and Verifier roles.
- Read-only policy enforcement for Planner/Reviewer/Verifier.
- Structured evidence handoffs instead of free-form agent chat.
- Bounded Reviewer → Implementer revision rounds.
- Verifier rejection can enter the bounded Debugger loop.
- Role-specific Ollama model selection.
- Agent handoffs, verdicts, findings, and policy violations in evidence reports.

## v0.8 — IDE / browser computer use
- Computer-use driver abstraction.
- VS Code/browser automation.
- Persistent GUI process lifecycle.
- Mouse/keyboard workflows, accessibility-tree inspection, and recorded interaction trace.

## v0.9 — Product hardening
- Windows installer and local web dashboard.
- Hardware-aware model profiles and resource policies.
- Secrets/permission controls, signed provenance, crash recovery, task queue.
- Repository/task history and human approval checkpoints.

## v1.0 — Verified autonomous software engineering
A task can be given as a goal plus repository. ForgePilot understands the repository, plans with separated roles, proves a regression where practical, implements a bounded change in a controlled environment, builds, tests, launches when appropriate, visually/behaviorally verifies the result, repairs failures, and returns evidence-backed artifacts plus an attributable Git diff. Destructive/network actions remain permission-gated and success claims are backed by verifier evidence.
