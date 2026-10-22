# Changelog

## v0.3.0 — Repository Intelligence

### Added

- Git-backed repository scanner using `git ls-files -co --exclude-standard`.
- `.gitignore`-aware filesystem fallback scanner for non-Git workspaces.
- Detection for Node/TypeScript, common Node frameworks, .NET, Maven/Gradle, Python, Go, Rust, Godot, C, and C++.
- Automatic build/test/lint command hints based on repository structure and package scripts.
- Goal-aware source-file ranking.
- Approximate token-budgeted source context for AI planners.
- `forgepilot analyze` command.
- Git baseline fingerprints captured before task execution.
- Human-readable added/modified/deleted change summary.
- Expected-vs-unexpected file classification.
- `git_diff` independent verification check.
- Optional `enforceGitScope` task-level verification.
- `expectedChangePaths` for generator/build side effects.
- Godot/Godot4 added to the executable allowlist and doctor probes.
- Six repository-intelligence tests, bringing the release suite to 18 tests.

### Changed

- Ollama planning and repair prompts now receive selected repository source context, project metadata, and build/test hints instead of only a filename list.
- Repair checkpoints now persist the original Git baseline, preserving accurate change attribution across `--resume`.
- Markdown reports include repository detection and Git change summaries.

### Privacy / safety

- Source excerpts used for planner context are transient and are stripped from persistent run reports.
- `git_diff` verification fails closed if the fingerprint scan is known to be incomplete.
- Existing plan-only default, workspace path guard, shell-free execution, executable allowlist, patch occurrence guard, and bounded repair budget remain in force.

## v0.2.0 — Autonomous Repair Loop

- Evidence-driven bounded repair loop.
- `replace_text` surgical patch action.
- Verification-failure repair.
- Persistent checkpoints and `--resume`.
- Explicit failure/repair/retry evidence in reports.
- 12 passing tests.

## v0.1.0 — Guarded Execution

- Node 22 CLI.
- Scripted and Ollama planners.
- Guarded workspace file operations.
- Allowlisted shell-free command execution.
- Independent verification.
- Git status capture and evidence reports.
- 6 passing tests.
