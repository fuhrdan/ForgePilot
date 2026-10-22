# Changelog

## 0.4.0 — 2026-10-22

### Added
- Test-first AUTHOR → RED → IMPLEMENT → GREEN → REGRESSION → BUILD workflow.
- Repository test-file inventory and targeted test ranking.
- Direct targeted gates for Node `node --test` and Python `pytest` where safely derivable.
- RED failure-signature checks (`failureIncludes`, `stdoutIncludes`, `stderrIncludes`).
- False-green and test-infrastructure failure protection.
- Test-only authoring policy and RED-proven test immutability.
- GREEN/regression/build gates integrated with bounded repair.
- LCOV and coverage-summary ingestion.
- Test-first demo project and dedicated documentation.

### Changed
- Repository analysis now exposes testing inventory and executable gates.
- Ollama planner prompt understands test-first plans and immutable RED-proven tests.
- Git expected-path calculation includes test-authoring changes.
- Child command environment strips Node's parent test-harness control variable before repository test execution.
- Checkpoint schema advances to v4 for test-first evidence/snapshots.

### Validation
- 26 automated tests passing, including all v0.1–v0.3 regressions.

## 0.3.0 — 2026-10-22
- Repository intelligence, token-budgeted context, project detection, Git baseline/diff verification.

## 0.2.0 — 2026-10-22
- Bounded autonomous repair loop, surgical patches, checkpoints and resume.

## 0.1.0 — 2026-10-22
- Guarded local execution, Scripted/Ollama planning, and independent verification.
