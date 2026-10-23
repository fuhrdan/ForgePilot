# ForgePilot v0.6 Validation

## Automated suite

Run:

```text
npm test
```

Expected release result:

```text
tests 43
pass 42
fail 0
```

All v0.1–v0.5 tests are preserved. v0.6 adds coverage for:

- dependency-free PNG encode/decode round-trip;
- changed-pixel and channel-delta metrics;
- visual evidence capture and deterministic assertions;
- frozen-baseline tamper detection;
- implementation policy blocking baseline rewrites;
- visual regression failure → bounded repair → recapture → PASS;
- visual capture routing through the configured execution provider;
- local Ollama multimodal request/structured verdict parsing via a mocked endpoint;
- fail-closed `vision` assertions when no provider exists.

## Visual CLI acceptance

The included `examples/visual-project` intentionally renders the wrong color first. Run:

```powershell
node src/cli.js run examples/visual-project/task.json `
  --workspace examples/visual-project `
  --apply
```

Acceptance requires:

1. initial PNG capture succeeds;
2. `pixel_diff` fails against the frozen baseline;
3. failure metrics enter the repair evidence;
4. the scripted repair changes the renderer, not the baseline;
5. the PNG is recaptured;
6. dimensions, pixel diff, and region mean all pass;
7. report result is PASS and an evidence screenshot is recorded.

## Direct image-comparison acceptance

Run `compare-images` against identical images and require PASS, then against differing images with `--max-changed-ratio 0` and require FAIL/exit code 2.

## Sandbox note

The build environment used for these releases may not expose Docker/Podman. Container command construction and provider routing remain covered by the v0.5 injected-runtime tests. On a Docker/Podman host, visual capture commands inherit the same sandbox provider and captured evidence is exported before sandbox cleanup.

## Archive acceptance

Before release:

1. syntax-check every `.js` file;
2. run all 43 tests in the working tree;
3. run the visual CLI failure→repair acceptance;
4. run direct `compare-images` PASS and FAIL checks;
5. verify CLI version prints `0.6.0`;
6. create the ZIP;
7. extract the exact ZIP to a clean directory;
8. rerun all 43 tests from the extracted archive;
9. rerun the visual CLI acceptance from the extracted archive;
10. verify no transient `.forgepilot/` state is included in the archive.
