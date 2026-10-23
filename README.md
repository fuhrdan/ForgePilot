# ForgePilot v0.6.0

**A local-first software-engineering agent that proves code and UI changes with executable evidence.**

ForgePilot combines repository intelligence, test-first engineering, bounded repair, independent verification, disposable Docker/Podman execution, and now **visual application verification**. A build can compile and still fail if its rendered state does not match the expected visual evidence.

## Requirements

- Node.js 22+
- Git recommended
- Docker or Podman for `--sandbox`
- Ollama optional for local-AI planning/debugging
- A multimodal Ollama model optional for `vision` assertions
- Chromium/Chrome optional for command-driven web screenshots

ForgePilot has no npm runtime dependencies.

## Quick start

```powershell
npm test
node src/cli.js doctor
node src/cli.js analyze . --goal "improve visual verification"
```

Run the deterministic visual-repair demo:

```powershell
node src/cli.js run examples/visual-project/task.json `
  --workspace examples/visual-project `
  --apply
```

The first screenshot is deliberately wrong. ForgePilot records the pixel-diff failure, applies the bounded scripted repair, recaptures, and requires the visual gate to pass.

Compare two PNGs directly:

```powershell
node src/cli.js compare-images actual.png baseline.png `
  --channel-threshold 2 `
  --max-changed-ratio 0.005
```

## What v0.6 adds

```text
Repository / Goal
      |
      v
AUTHOR → RED → IMPLEMENT → GREEN → REGRESSION → BUILD
      |
      v
Screenshot Capture
      |
      +--> Dimensions / pixel probes / region means
      +--> Frozen-baseline pixel diff
      +--> Optional local Ollama vision verdict
      |
      v
Independent Verification
      |
    PASS? ------------------ FAIL
      |                       |
      v                       v
Sandbox promotion       bounded repair
      |                       |
      +-----------------------+
```

### Visual checkpoints

A task can declare one or more visual checkpoints:

```json
{
  "visual": {
    "checkpoints": [
      {
        "name": "main-ui",
        "capture": {
          "command": "node",
          "args": ["tools/capture.js"],
          "path": "out/main-ui.png"
        },
        "assertions": [
          { "type": "dimensions", "width": 1280, "height": 720 },
          {
            "type": "pixel_diff",
            "baseline": "baselines/main-ui.png",
            "channelThreshold": 2,
            "maxChangedRatio": 0.005
          }
        ]
      }
    ]
  }
}
```

Captured evidence is copied beneath:

```text
.forgepilot/visual/<task-id>/
```

Sandboxed runs export those evidence images before the disposable workspace is cleaned up.

### Frozen visual baselines

ForgePilot fingerprints visual baselines before implementation. The implementation/repair loop is not permitted to modify those files, and the verifier checks the baseline hash again before pixel comparison.

This prevents an agent from making a visual regression disappear by silently replacing the expected screenshot.

### Deterministic assertions

v0.6 supports:

- `dimensions`
- `pixel_diff`
- `pixel_probe`
- `region_mean`
- `vision`

The built-in PNG path reports changed-pixel ratio, mean delta, RMS delta, and max channel delta without an npm image dependency.

### Optional local vision model

A visual assertion may ask a local Ollama multimodal model to evaluate semantic UI criteria:

```json
{
  "type": "vision",
  "prompt": "Verify the dashboard is ready.",
  "criteria": [
    "No error dialog is visible",
    "Status indicator is green"
  ],
  "minConfidence": 0.75
}
```

Configure it in `task.visual.provider` or with:

```text
--vision-model MODEL
--vision-url URL
```

No model is contacted unless a `vision` assertion is configured and a provider/model is explicitly supplied.

## Sandboxed visual verification

`--sandbox` still runs repository code in a disposable copy with Docker/Podman limits. Visual capture commands use that same execution provider, so screenshot-generation commands do not accidentally leak back to the host during a sandboxed run.

```powershell
node src/cli.js run task.json `
  --workspace .\repo `
  --sandbox `
  --sandbox-image my-prepulled-ui-test-image `
  --apply
```

Default container policy remains:

```text
network       none
CPUs          2
memory        2g
PID limit     256
capabilities  ALL dropped
privileges    no-new-privileges
image pull    never
```

## Test-first engineering

The v0.4 workflow remains intact:

```text
AUTHOR regression test
   ↓
RED — must fail for the expected reason
   ↓
freeze RED-proven test
   ↓
IMPLEMENT
   ↓
GREEN → REGRESSION → BUILD
   ↓
visual verification (when configured)
   ↓
Git scope + test integrity + independent checks
```

Both RED-proven tests and visual baselines are protected evidence.

## Repository intelligence and repair

ForgePilot detects Node/TypeScript, .NET, Java/Maven/Gradle, Python, Go, Rust, Godot, and generic C/C++ projects. Failures—including visual failures—become structured evidence for the bounded repair loop:

```text
failure → diagnose → surgical patch → retry → independently verify
```

Use `--max-repairs N`. Host mode supports `--resume`; sandbox resume remains intentionally deferred.

## Guarded actions

Normal implementation/repair actions remain:

- `write_file`
- `replace_text`
- `run_command`

Normal commands run without a shell and remain allowlisted. The visual capture path has a separate allowlist that additionally permits Chromium/Chrome executables for screenshot capture; those browser commands are not exposed to ordinary `run_command` actions.

## Validation

```text
v0.1   6 tests
v0.2  12 tests
v0.3  18 tests
v0.4  26 tests
v0.5  33 tests
v0.6  43 tests
```

The v0.6 tests add PNG codec/diff coverage, visual checkpoint evidence, baseline-integrity enforcement, protected-baseline policy, visual failure→repair→recapture, execution-provider routing, mocked Ollama vision evaluation, and fail-closed behavior without a configured vision provider.

See:

- `docs/VISUAL_VERIFICATION.md`
- `docs/SANDBOX.md`
- `docs/TEST_FIRST.md`
- `docs/REPOSITORY_INTELLIGENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/VALIDATION.md`
- `docs/ROADMAP.md`

## Next milestone — v0.7

**Multi-Agent Engineering Roles**: separate Planner, Implementer, Debugger, Reviewer, and Verifier roles exchanging structured evidence instead of a single model owning the whole engineering narrative.
