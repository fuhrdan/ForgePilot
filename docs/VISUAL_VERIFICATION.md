# ForgePilot v0.6 Visual Verification

v0.6 adds evidence-backed visual gates to the same bounded repair loop used by build and test failures.

## Trust model

A visual PASS is not based on the planner saying the UI looks correct. ForgePilot captures a PNG, stores an evidence copy beneath `.forgepilot/visual/<task-id>/`, and evaluates configured assertions independently.

Checked-in visual baselines are fingerprinted **before implementation starts**. Implementation and repair actions are blocked from modifying baseline paths, and pixel-diff verification checks the baseline hash again before comparing pixels.

## Task configuration

```json
{
  "visual": {
    "checkpoints": [
      {
        "name": "main-window",
        "capture": {
          "command": "node",
          "args": ["tools/render-screenshot.js"],
          "path": "out/main-window.png",
          "timeoutMs": 120000
        },
        "assertions": [
          { "type": "dimensions", "width": 1280, "height": 720 },
          {
            "type": "pixel_diff",
            "baseline": "baselines/main-window.png",
            "channelThreshold": 2,
            "maxChangedRatio": 0.005,
            "maxMeanDelta": 1.0
          },
          { "type": "pixel_probe", "x": 40, "y": 40, "rgba": [0, 255, 180, 255], "tolerance": 8 },
          {
            "type": "region_mean",
            "region": { "x": 0, "y": 0, "width": 200, "height": 80 },
            "rgba": [12, 20, 30, 255],
            "tolerance": 10
          }
        ]
      }
    ]
  }
}
```

`capture.command` is optional. If omitted, `capture.path` must already contain the PNG to verify. Capture commands use the same execution provider as the rest of the task, so sandboxed tasks keep screenshot generation inside the disposable environment.

## Assertions

### `dimensions`
Requires exact width/height when supplied.

### `pixel_diff`
Compares an 8-bit PNG against a frozen baseline. v0.6 reports:

- changed pixel count and ratio;
- mean absolute channel delta;
- RMS channel delta;
- maximum channel delta;
- optional crop/region metrics.

Supported thresholds are `channelThreshold`, `maxChangedRatio`, `maxMeanDelta`, and `maxRmsDelta`.

### `pixel_probe`
Checks one exact pixel against expected RGBA values with a tolerance.

### `region_mean`
Checks the mean RGBA value of a rectangular region. This is useful for deterministic states such as a status panel expected to be green/red/disabled.

### `vision`
Uses an optional local Ollama multimodal model. Example:

```json
{
  "visual": {
    "provider": {
      "type": "ollama",
      "model": "qwen3-vl:8b",
      "baseUrl": "http://127.0.0.1:11434"
    },
    "checkpoints": [
      {
        "name": "dashboard",
        "capture": { "path": "out/dashboard.png" },
        "assertions": [
          {
            "type": "vision",
            "prompt": "Verify the dashboard is ready for use.",
            "criteria": [
              "No visible error dialog",
              "The status indicator is green",
              "The primary table is visible"
            ],
            "minConfidence": 0.75
          }
        ]
      }
    ]
  }
}
```

The provider must return a structured evidence verdict. If no vision provider is configured, a `vision` assertion fails closed.

CLI flags may override the model/provider URL:

```powershell
node src/cli.js run task.json --vision-model qwen3-vl:8b --vision-url http://127.0.0.1:11434 --apply
```

## Capture command allowlist

Visual capture commands use a dedicated allowlist consisting of the normal ForgePilot commands plus:

```text
chromium chromium-browser google-chrome google-chrome-stable
```

Those browser executables are available only to the visual capture path; they are not added to the normal agent `run_command` allowlist.

A static web page can therefore be captured with a trusted installed browser, for example:

```json
{
  "capture": {
    "command": "chromium",
    "args": [
      "--headless",
      "--disable-gpu",
      "--screenshot=out/page.png",
      "--window-size=1280,720",
      "file:///workspace/index.html"
    ],
    "path": "out/page.png"
  }
}
```

Exact browser flags/paths vary by host/container image.

## Repair loop

Visual failures participate in the normal bounded repair loop:

```text
capture → deterministic/vision assertions → FAIL
   ↓
structured visual metrics become repair evidence
   ↓
small source repair
   ↓
recapture → reverify
```

The baseline remains protected during those repairs.

## PNG scope in v0.6

The built-in decoder supports non-interlaced, 8-bit PNGs in grayscale, RGB, grayscale+alpha, and RGBA formats. The project intentionally has no npm runtime dependency for image comparison.

Mouse/keyboard computer-use automation is still deferred to v0.8. v0.6 verifies rendered states and records command-driven capture evidence; it does not pretend that screenshot comparison is equivalent to full interactive GUI testing.
