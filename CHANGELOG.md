# Changelog

## 0.8.0 — Computer / IDE Control

### Added
- Persistent `ComputerSession` with ordered interaction trace and screenshot evidence.
- Real Chrome DevTools Protocol driver for Chromium/Chrome and CDP-enabled Electron targets.
- Deterministic replay driver for CI and regression tests.
- `computer_navigate`, `computer_inspect`, `computer_assert`, `computer_click`, `computer_type`, `computer_key`, `computer_wait`, and `computer_screenshot` actions.
- Accessibility-tree inspection and accessibility state assertions.
- CSS-selector click/type support plus coordinate clicking and keyboard dispatch.
- Screenshot capture to `.forgepilot/computer/<task-id>/` and computer evidence in reports.
- CLI controls: `--computer`, `--computer-driver`, `--computer-endpoint`, `--computer-target`.
- `docs/COMPUTER_CONTROL.md` and deterministic replay demo.

### Changed
- Computer-action failures participate in the bounded v0.2 repair/retry loop.
- Ollama Implementer/Debugger action schema includes computer-control actions.
- Sandbox evidence export supports computer traces/screenshots in addition to visual evidence.
- `doctor` now probes common Chromium and VS Code executables.

### Safety
- Navigation is localhost-only by default and external origins require explicit allowlisting.
- Existing target URLs are validated before inspection/interaction, preventing an already-open external tab from bypassing navigation policy.
- `data:` navigation is opt-in and file navigation is workspace-confined.
- Typed values are redacted from traces by default.
- Computer screenshot paths are evidence-directory confined.
- Planner/Reviewer/Verifier cannot smuggle computer-control actions through read-only verdicts.
- Real computer control is blocked when `--sandbox` is active in v0.8 because a host IDE could bypass PASS-only promotion.
- CDP navigation fails when the browser reports `errorText`; it cannot be recorded as a false PASS.
