# Changelog

## 0.16.0 — Just Build It

- Makes a single plain-language **BUILD IT** prompt the default dashboard workflow; project/repository setup is optional.
- Automatically creates new projects under the ForgePilot workspace when no existing project path is supplied.
- Forces Simple Build Mode to one coding agent by default, bounded repairs, and only local file-write/command grants; advanced capabilities remain denied unless explicitly used through advanced controls.
- Adds a hard Ollama generation timeout (120 seconds by default) with visible progress heartbeats and automatic smaller-model fallback.
- Adds dashboard no-progress and overall-job watchdogs (5 minutes and 30 minutes by default) that terminate stalled work with an explicit reason instead of running indefinitely.
- Raises the default individual build/test command ceiling to a bounded 5 minutes for legitimate compiles while retaining forced timeout behavior.
- Adds plain-language live phases and elapsed time to job cards.
- Adds `forgepilot build <description>` as the CLI equivalent of the Just Build It path.
- Preserves one-click Windows install/run, adaptive low-resource tuning, signed provenance, reversible checkpoints/rollback, evidence confidence, and all advanced v0.1-v0.15 workflows.
- Adds 8 regression tests covering automatic project creation, single-agent task policy, model timeout/fallback, silent-child watchdog termination, progress phases, and the token-protected Just Build It API/UI.

## 0.16.0 — Evidence Confidence + Verified Patch Review

- Adds a deterministic 0–100 evidence-confidence score to every signed run report; the score explicitly states that it is not a probability of correctness.
- Scores deterministic verification, test-first evidence, Git scope, independent Verifier approval, visual checks, coverage, and repair count with transparent reasons and evidence gaps.
- Dashboard confidence conservatively adjusts the signed score using provenance validity, preflight risk, rollback/checkpoint availability, change-set size, and sensitive-path changes.
- Adds privacy-preserving patch review metadata with per-file status, byte counts, text/binary classification, estimated line deltas, and path sensitivity; source contents are never stored in patch-review state.
- Adds `forgepilot assess <report.json>` for CLI evidence review and provenance status.
- Dashboard job cards and recent-run history now show confidence and patch-review summaries.
- Retains v0.14 one-click Windows install/run, adaptive resource governor, model fallback, persistent queue, signed provenance, checkpoints, and conflict-safe rollback.

## 0.14.0 — Adaptive Runtime Health + Low-Resource Model Fallback

### Added
- `forgepilot health [workspace]` local self-test for Node 22+, workspace read/write access, current RAM headroom, and optional local Ollama availability.
- Runtime-health dashboard card and `/api/health` loopback endpoint.
- Per-job resource recheck before queued dashboard AI work starts.
- Conservative runtime governor that can downgrade context, repair budget, review rounds, multi-agent mode, and model when current free RAM is worse than the configured plan.
- Local Ollama installed-model discovery via `127.0.0.1` only.
- Bounded coding-model fallback chains (for example 7B -> 3B -> 1.5B).
- Ollama planner retry on retryable local-runtime failures without shell/network download behavior.
- One-click installer health/self-test log and one-click launcher health display.
- 8 new adaptive-runtime regression tests.

### Low-resource safety
- ForgePilot never auto-upgrades beyond the configured machine plan during a job; runtime adaptation only keeps or reduces resource use.
- Local AI job launch is blocked before checkpoint/execution when less than 1.25 GiB RAM is currently available.
- Missing Ollama remains an optional/limited state rather than making deterministic ForgePilot features unusable.
- Model fallback only targets configured/local model names and never downloads a model during an engineering job.

### Validation
- Full regression suite: 117/117 passing before release packaging; existing v0.1-v0.13 behavior remains covered.
- New tests cover fallback ordering, local Ollama discovery, pressure-only downgrade, installed-model selection, critical-memory blocking, self-test semantics, real HTTP planner fallback, and dashboard task throttling.

## 0.13.0 — Workspace Intelligence + Reversible Change Safety

### Added
- Repository change preflight with low/medium/high risk classification and explicit reasons.
- Preflight evidence for likely touch points, test context, repository size, and pre-existing dirty Git paths without returning source contents.
- Automatic pre-job workspace checkpoints for dashboard engineering jobs.
- Exact post-run change sets with added/modified/deleted counts and SHA-256 before/after evidence.
- Conflict-safe rollback that restores the exact pre-job state, including pre-existing user edits.
- Rollback dry-run mode and dashboard confirmation flow.
- `forgepilot preflight` and `forgepilot rollback` advanced CLI commands.
- Dashboard rollback API protected by the existing per-launch control token.
- Dashboard risk badges and post-run change summaries.
- 10 new workspace-safety regression tests.

### Safety
- Rollback never uses `git reset --hard`.
- A rollback path is restored only when its current hash still matches ForgePilot's recorded post-run hash; newer human edits cause a conflict and are left untouched.
- Checkpoints exclude `.forgepilot`, dependency/build-output directories, and ignored files through the existing repository scanner.
- Dashboard jobs remain in a `finalizing` phase until signed-report/provenance and checkpoint finalization are complete; PASS is not exposed early.
- Large/truncated checkpoints fail closed rather than claiming reversibility without complete evidence.

### Validation
- Full regression suite: 109/109 passing; existing v0.1-v0.12 behavior remains covered.
- New tests cover add/modify/delete restoration, pre-existing dirty-state restoration, post-run edit conflicts, dry-run rollback, high-risk preflight, dirty-path privacy, dashboard change summaries, and token-protected rollback API behavior.

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
