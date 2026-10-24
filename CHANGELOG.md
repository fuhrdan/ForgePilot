# Changelog

## 0.12.0 — Persistent Project Workspaces + Reusable Recipes + Resumable Queue

### Added
- Persistent saved-project registry with repository path, recipe, autonomy, approvals, and sandbox defaults.
- Four immutable built-in engineering recipes: fix bug test-first, add feature, read-only repository review, and prepare release.
- Persistent custom recipe creation/deletion from the browser control center.
- Recipe goal expansion while preserving explicit capability approvals and existing safety boundaries.
- Persistent FIFO dashboard task queue with conservative default concurrency of one local engineering job.
- Global queue pause/resume controls.
- Per-job pause/resume for queued jobs, cancellation for queued/paused/running jobs, and auditable retry for terminal/interrupted jobs.
- Queue journal under `.forgepilot/dashboard/queue.json`; saved projects and recipes live beside it.
- Dashboard restart recovery: stale running jobs become `interrupted` instead of being guessed PASS/FAIL.
- `retryOf` linkage in job metadata and public dashboard evidence.
- Project/recipe/queue HTTP APIs protected by the existing per-launch control token.
- 10 new project/recipe/queue regression tests.

### Changed
- Dashboard-created jobs now enter the persistent queue instead of spawning immediately.
- Default queue concurrency is one to avoid competing local-LLM jobs on low-resource machines.
- v0.12 does not fake suspension of an already-running Windows child process; pause/resume is intentionally limited to queued jobs, while running jobs can be cancelled and retried.
- The browser dashboard can select saved projects and recipes, persist current settings, and show queue state/retry lineage.

### Validation
- Full regression suite: 99/99 passing.
- Existing v0.1-v0.11 behavior remains covered.
- Release acceptance includes real subprocess FIFO queueing, built-in recipe use, signed PASS provenance, retry lineage, and exact-ZIP clean-room revalidation.

## 0.11.0 — Local Engineering Control Center

### Added
- Browser-based repository/job control center on top of the one-click launcher.
- Repository path + natural-language goal form; task JSON is generated automatically.
- Repository analysis from the UI with detected projects/frameworks, build/test hints, and relevant file names without returning source excerpts.
- Safe / Standard / Thorough autonomy presets.
- Explicit per-job capability grants for file writes, command execution, computer control, external network, secret use, and sandbox networking.
- Optional disposable-sandbox toggle.
- Dashboard job queue/status, live recent logs, coarse execution phases, cancellation, and signed-result indicator.
- `DashboardJobManager` with shell-free child-process launching and bounded in-memory logs.
- Per-launch dashboard control token required for every mutating API request.
- Stricter dashboard CSP, frame denial, no-store API responses, and report-path confinement.
- 9 new control-center regression tests.

### Changed
- One-click launch now opens a control center instead of a read-only run-history dashboard.
- UI-created tasks require all sensitive approval categories and grant only the categories explicitly selected by the user.
- Dashboard-generated tasks inherit the machine-adaptive model/context/repair/review defaults from v0.10.
- Signed status is derived from the exact `report.json` provenance rather than the human-readable Markdown report.

### Validation
- Full regression suite: 89/89 passing.
- End-to-end dashboard-created job accepted through a real ForgePilot subprocess and local Ollama-compatible mock endpoint.
- Acceptance job produced an evidence artifact, PASS verification, signed JSON provenance, and a readable Markdown report.

## 0.10.0 — One-Click Windows + Adaptive Low-Resource Runtime

### Added
- Root-level `INSTALL_FORGEPILOT.cmd` for double-click installation.
- Root-level `RUN_FORGEPILOT.cmd` and a Desktop ForgePilot shortcut for double-click launch.
- Automatic Windows prerequisite bootstrap through `winget` for Node.js 22+, Git, and optional Ollama, plus a portable Node.js fallback when `winget` is unavailable.
- `forgepilot setup` system inspection and persisted machine configuration.
- `forgepilot launch` loopback-only browser dashboard startup.
- RAM, available-RAM, CPU, GPU/VRAM, free-disk, and developer-tool inspection.
- Adaptive minimal/low-resource/balanced/high-quality machine plans.
- 1.5B and 3B conservative coding-model choices for small systems.
- Process-local Ollama concurrency/loaded-model/keep-alive limits for one-click runs.
- Automatic Documents\ForgePilot Workspace creation.
- Desktop shortcut creation and preserved workspace on uninstall.
- Launcher dashboard cards showing the selected machine tier/model/resource plan.

### Changed
- Normal task runs now reuse the persisted machine profile when no task/CLI override is supplied.
- Low-memory plans disable the vision model and multi-agent team by default.
- The automatic first model download is capped at 7B even on high-resource systems.
- The v0.9 installer remains available as a wrapper around the new one-click installer.

### Safety / reliability
- Dashboard remains loopback-only.
- Automatic AI/model installation is best-effort and does not prevent deterministic ForgePilot use when optional downloads fail.
- Low-resource tuning is process-local; the launcher does not permanently rewrite global Ollama concurrency settings.
- Explicit task/CLI choices still override machine defaults.
- Windows native installer/shortcut execution is not executable-tested on this Linux build host; PowerShell scripts are kept Windows PowerShell 5.1 compatible and the Node-side contracts are covered by automated tests.

## 0.9.0 — Product Hardening

### Added
- Environment-backed `SecretStore` with `${{ secret.alias }}` templates and `{ "secretRef": "alias" }` values.
- Redaction of resolved secret values from command results and persisted run data.
- Opt-in approval categories: `file_write`, `command_exec`, `computer_control`, `external_network`, `secret_use`, and `sandbox_network`.
- `--approve`, `--approve-all`, and task-level `permissions.require` / `permissions.grants`.
- Recovery journals under `.forgepilot/recovery/` plus `forgepilot recover` stale/interrupted-run inspection.
- Local Ed25519 provenance keypair, report SHA-256/signature records, and `forgepilot verify-run`.
- Hardware-aware `low-resource`, `balanced`, and `high-quality` profiles plus `forgepilot profile`.
- Local loopback dashboard with signed-run status via `forgepilot dashboard`.
- Native Windows UI Automation driver (`windows-ui`) using a fixed PowerShell/.NET UIAutomation bridge.
- Windows user-level installer script and launcher.
- Hardened approval demo and product-hardening documentation.

### Changed
- Command/test/verification/visual execution can share the same approval and secret policy.
- Internal `.forgepilot` state is filtered from Git working-tree status reporting.
- `doctor` reports RAM/CPU profile recommendation and probes PowerShell.
- Computer driver CLI recognizes `windows-ui` in addition to CDP/replay.
- Reports include selected product profile and non-secret permission/secret-reference metadata.

### Safety
- Secret configuration accepts environment references, not inline secret values.
- Known resolved secrets are redacted before reports are written.
- Approval gates are additive; they never bypass command allowlists, workspace confinement, sandbox limits, origin policy, or agent role separation.
- Native Windows UI payloads are supplied through an environment variable rather than interpolated into PowerShell source.
- Native coordinate clicking is disabled in v0.9 in favor of auditable AutomationId/name targeting.
- Provenance detects report tampering and can optionally verify against a trusted public key.

## 0.8.0 — Computer / IDE Control

- Persistent CDP/replay sessions, accessibility inspection/assertions, guarded UI actions, screenshot evidence, origin validation, and replayable interaction traces.
