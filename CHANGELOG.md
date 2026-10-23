# Changelog

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
