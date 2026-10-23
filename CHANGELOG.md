# Changelog

## v0.6.0 — Visual Application Verification

- Added dependency-free PNG evidence decoding/encoding for non-interlaced 8-bit grayscale/RGB/RGBA images.
- Added deterministic image comparison with changed-pixel ratio, mean delta, RMS delta, max channel delta, and optional comparison regions.
- Added visual checkpoint capture through the same host/container execution-provider boundary used by build/test verification.
- Added `dimensions`, `pixel_diff`, `pixel_probe`, and `region_mean` assertions.
- Added frozen visual-baseline hashing before implementation begins.
- Added policy protection preventing implementation/repair actions from modifying configured visual baselines.
- Added baseline-integrity verification immediately before pixel comparison.
- Visual assertion failures now participate in the existing bounded repair/reverify loop.
- Added `.forgepilot/visual/<task-id>/` evidence copies and sandbox export of visual evidence back to the same host evidence path.
- Added optional local Ollama multimodal verification through the `vision` assertion.
- Vision assertions fail closed when no provider is configured or the provider errors.
- Added `--vision-model` and `--vision-url` CLI overrides.
- Added `compare-images` CLI command for direct baseline comparisons.
- Added a visual-capture-specific allowlist including Chromium/Chrome without exposing browser executables to normal agent commands.
- Added `docs/VISUAL_VERIFICATION.md` and a runnable `examples/visual-project` failure→repair demo.
- Expanded automated suite from 33 to 43 tests while preserving all prior tests.

### Scope note

v0.6 verifies rendered PNG states and command-driven screenshot evidence. Full mouse/keyboard computer-use automation remains a later milestone; this release does not claim that screenshot comparison alone proves arbitrary interactive GUI behavior.
