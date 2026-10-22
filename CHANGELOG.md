# Changelog

## v0.5.0 — Disposable Sandbox

- Added an execution-provider abstraction shared by actions, RED/GREEN gates, verification commands, and repair retries.
- Added Docker and Podman runtime detection.
- Added opt-in `--sandbox` execution against a disposable copy of the repository.
- Added default container hardening: no network, CPU/RAM/PID limits, dropped capabilities, `no-new-privileges`, bounded tmpfs, and `--pull never`.
- Preserved ForgePilot's executable allowlist inside container mode.
- Added PASS-only workspace promotion using before/after file manifests.
- Failed sandbox runs leave the original source tree unchanged.
- Added explicit artifact copy-out to `.forgepilot/artifacts/<task-id>/` without requiring source promotion.
- Added sandbox metadata to JSON/Markdown reports.
- Added `--sandbox-runtime`, `--sandbox-image`, and `--sandbox-keep`.
- `doctor` now reports Docker/Podman and the selected sandbox runtime.
- Added `docs/SANDBOX.md`.
- Expanded automated suite from 26 to 33 tests.
- Preserved all v0.1–v0.4 tests and host-mode behavior.

### Known limitation

The validation environment for this release does not provide Docker or Podman, so container invocation is validated with an injected runner plus CLI runtime-unavailable behavior. The complete host workflow is additionally exercised end-to-end. On a machine with Docker/Podman installed, the new provider executes the constructed container command directly.
