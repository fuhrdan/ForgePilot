# Changelog

## 0.2.0 — 2026-10-22

First autonomous repair release.

### Added
- Evidence-driven repair loop for failed implementation commands.
- Repair loop for failures discovered by the independent verifier.
- Global bounded repair budget via `--max-repairs`.
- `replace_text` patch action with exact-occurrence safety guard.
- Ollama debugger/repair prompt that receives the original plan and bounded failure evidence.
- Scripted deterministic repair fixtures for automated testing.
- Per-task checkpoints under `.forgepilot/state/`.
- `--resume` support for continuing a failed/checkpointed task.
- Repair/retry evidence in JSON and Markdown reports.
- `examples/repair-task.json` demonstration.
- Six additional automated tests, bringing the suite to 12 tests.

### Changed
- Reports now distinguish original actions from retried actions.
- Reports include task ID, resume status, repair budget, repair rationale, and retry outcome.
- Ollama repair instructions prefer surgical `replace_text` edits over full-file rewrites.
- CLI reports the active repair budget.

### Safety
- Repair attempts remain behind the existing `--apply` permission gate.
- No shell access was added.
- Repair commands use the same executable allowlist as initial actions.
- Repair file operations use the same workspace-containment guard.
- Ambiguous text patches fail closed rather than replacing multiple unexpected matches.

## 0.1.0 — 2026-10-22

Initial working prototype.

### Added
- Dependency-free Node 22 CLI.
- `init`, `doctor`, `clone`, and `run` commands.
- Scripted task planner for deterministic testing.
- Ollama planner using `/api/generate` with JSON output.
- Workspace path-containment guard.
- Shell-free executable allowlist.
- Explicit `--apply` permission gate.
- File-writing and command-running actions.
- Independent file/content/command verification.
- Git state capture.
- Markdown and JSON evidence reports.
- Six automated tests.
- Example scripted and Ollama tasks.
- v0.1 → v1.0 roadmap.
