# ForgePilot v0.8 Computer / IDE Control

v0.8 adds a persistent computer-use session that is separate from shell execution. The built-in real driver uses the Chrome DevTools Protocol (CDP), so it can control Chromium/Chrome and CDP-enabled Electron applications such as VS Code builds that expose a debugging endpoint. A deterministic replay driver is included for CI and regression tests.

## Supported actions

- `computer_navigate` — navigate to an allowlisted URL.
- `computer_inspect` — capture a bounded accessibility-tree snapshot.
- `computer_assert` — require an accessibility role/name/value/text match.
- `computer_click` — click a CSS selector or explicit x/y point.
- `computer_type` — focus a CSS selector and insert text.
- `computer_key` — dispatch a key event.
- `computer_wait` — bounded UI wait.
- `computer_screenshot` — capture PNG evidence under `.forgepilot/computer/<task-id>/`.

All actions are sequential within one persistent session. Failures participate in the same bounded Debugger repair loop as command/test/visual failures.

## CDP configuration

```json
{
  "computer": {
    "enabled": true,
    "driver": "cdp",
    "endpoint": "http://127.0.0.1:9222",
    "targetHint": "My App",
    "allowedOrigins": [
      "http://localhost",
      "http://127.0.0.1"
    ]
  }
}
```

ForgePilot connects to an existing debuggable target; it does not silently launch arbitrary GUI executables. Start the browser/Electron application yourself with its remote-debugging option, then point ForgePilot at that endpoint.

## Safety rules

- Navigation defaults to localhost HTTP/HTTPS only. External origins must be explicitly allowlisted.
- ForgePilot validates the *current target URL* before inspection or interaction, so connecting to an already-open external tab does not bypass the origin policy.
- `data:` navigation is disabled unless `allowDataUrls: true` is explicit.
- File URLs must remain inside the selected workspace.
- Typed text is redacted from the persistent trace by default. Set `"secret": false` only for non-sensitive values you intentionally want recorded.
- Screenshot paths are confined to the task evidence directory.
- Planner, Reviewer, and Verifier are read-only and cannot return computer-control actions.
- Real computer control cannot be combined with `--sandbox` in v0.8. An IDE open on the host repository could bypass PASS-only sandbox promotion, so ForgePilot fails closed instead. The replay driver may be used with sandboxed tests.

## Evidence

Each session writes:

```text
.forgepilot/computer/<task-id>/
    trace.json
    *.png
```

`trace.json` contains ordered action sequence numbers, timestamps, status, duration, target URL when available, redacted typing metadata, accessibility results, and screenshot evidence paths. The normal Markdown/JSON task report links to the trace directory.

## Deterministic demo

```powershell
node src/cli.js run examples/computer-task.json `
  --workspace .\work\computer-demo `
  --apply
```

The replay driver exercises the complete orchestration/report/evidence path without requiring a desktop session.
