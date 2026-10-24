# ForgePilot v0.10.0

**A local-first verified software-engineering agent with a one-click Windows install/run path and automatic low-resource tuning.**

ForgePilot combines repository intelligence, test-first engineering, bounded repair, Docker/Podman sandboxes, visual verification, separated Planner/Implementer/Debugger/Reviewer/Verifier roles, browser/IDE control, signed provenance, and v0.10 automatic system tuning.

## Windows: one-click install and run

1. Extract the release ZIP.
2. Double-click **`INSTALL_FORGEPILOT.cmd`** once.
3. When installation finishes, double-click the new **ForgePilot** shortcut on the Desktop.

The installer copies ForgePilot to `%LOCALAPPDATA%\ForgePilot`, creates `Documents\ForgePilot Workspace`, inspects RAM/available RAM, CPU count, GPU/VRAM, free disk, and installed developer tools, then writes a persistent machine profile. It attempts to bootstrap Node.js 22+, Git, and Ollama through `winget` when needed; Node also has a portable nodejs.org ZIP fallback when `winget` is unavailable. Ollama/model setup is best-effort: ForgePilot remains installed if an optional AI download cannot complete.

The one-click launcher applies low-resource-safe Ollama limits only to the ForgePilot process, starts Ollama when available, starts the loopback-only dashboard on a free local port, and opens it in the default browser. Close the launcher window to stop the dashboard.

Low-resource examples:

- Very small machine: 1.5B coding model, ~1.5K context, no vision model, multi-agent mode off.
- Modest machine: 3B coding model, ~2.3K context, no vision model, one loaded Ollama model.
- Balanced machine: 7B coding model by default; 14B only when RAM/VRAM is sufficient.

The automatic bootstrap model is capped at 7B even on large systems so a first install does not silently trigger a huge download.

## Requirements / bootstrap behavior

- Windows 10/11 recommended for the one-click path and native `windows-ui` driver.
- `winget` is preferred when Node.js 22+, Git, or optional Ollama need to be installed automatically. Node.js also has a per-user portable ZIP fallback.
- Docker/Podman remains optional for `--sandbox`.
- Chromium/Chrome or another CDP-enabled Electron application remains optional for CDP computer control.
- There are no npm runtime dependencies.

If automatic prerequisite installation is unavailable, the installer fails with the missing prerequisite instead of silently continuing with a broken runtime.

## CLI quick start

```powershell
node src/cli.js setup
node src/cli.js doctor
node src/cli.js profile auto
node src/cli.js launch --port 0
```

`setup` persists the automatic machine plan. Normal `run` commands reuse that plan unless a task or CLI flag explicitly overrides it.

Run the hardened approval demo:

```powershell
node src/cli.js run examples/hardened-task.json `
  --workspace .\work\hardened-demo `
  --approve file_write,command_exec `
  --apply
```

Every completed run now receives detached Ed25519 provenance:

```powershell
node src/cli.js verify-run .\work\hardened-demo\.forgepilot\runs\<run>\report.json
```

## v0.9 hardening flow

```text
Goal + Repository
      |
      v
Hardware / model profile
      |
      v
Environment-backed secret references
      |
      v
Permission / approval policy
      |
      v
Planner -> Implementer -> Guarded Executor
      |                     |
      |                     +-- host / sandbox
      |                     +-- CDP / native Windows UI
      v
Reviewer -> Tests / Build / Visual / UI -> Verifier
      |
      v
PASS / FAIL report
      |
      +-- recovery journal
      +-- Ed25519 signature + SHA-256 provenance
      +-- local run dashboard
```

## Permission checkpoints

Permissions remain backward-compatible by default. A task opts into explicit approval requirements:

```json
{
  "permissions": {
    "require": ["file_write", "command_exec", "computer_control"]
  }
}
```

Grant only what the run needs:

```powershell
node src/cli.js run task.json --approve file_write,command_exec --apply
```

Supported categories are:

```text
file_write
command_exec
computer_control
external_network
secret_use
sandbox_network
```

`--approve-all` grants all categories the task explicitly requires. It does not expand command allowlists, origin allowlists, workspace boundaries, or agent-role permissions.

## Secret references

ForgePilot does not require secrets to be stored in task files. Map aliases to environment variables:

```json
{
  "secrets": {
    "apiToken": { "env": "MY_API_TOKEN" }
  },
  "actions": [
    {
      "type": "run_command",
      "command": "node",
      "args": ["tool.js"],
      "env": {
        "API_TOKEN": { "secretRef": "apiToken" }
      }
    }
  ]
}
```

String templates also work: `${{ secret.apiToken }}`. Resolved values are transient and known values are redacted from command results, reports, and computer traces. Tasks can require the `secret_use` approval category.

## Signed provenance

On the first completed run ForgePilot creates a local Ed25519 keypair under:

```text
.forgepilot/keys/
    provenance-private.pem
    provenance-public.pem
```

Each run directory receives:

```text
report.json
report.md
provenance.json
```

`provenance.json` contains the report SHA-256, Ed25519 signature, public-key fingerprint, and public key. Verify a run with:

```powershell
node src/cli.js verify-run <report.json>
```

For an identity check against a trusted public key:

```powershell
node src/cli.js verify-run <report.json> --public-key .forgepilot\keys\provenance-public.pem
```

## Crash recovery

The existing v0.2 state checkpoints remain the source of resumable task state. v0.9 adds a separate operational journal under `.forgepilot/recovery/` to distinguish running, completed, crashed, and stale/interrupted runs.

```powershell
node src/cli.js recover .
```

When a task checkpoint exists, resume with the existing flow:

```powershell
node src/cli.js run task.json --resume --apply
```

## Hardware / model profiles

```powershell
node src/cli.js profile auto
node src/cli.js profile low-resource
node src/cli.js profile balanced
node src/cli.js profile high-quality
```

Profiles set sensible defaults for coding model, vision model, context budget, repair budget, and review rounds when the task/CLI has not already overridden them.

## Local dashboard

```powershell
node src/cli.js dashboard . --port 3210
```

The dashboard binds to `127.0.0.1` and shows local run history, status, ForgePilot version, and whether each report's provenance verifies.

## Native Windows UI Automation

v0.9 adds a `windows-ui` driver built on Windows UI Automation through a fixed PowerShell bridge:

```json
{
  "computer": {
    "enabled": true,
    "driver": "windows-ui"
  }
}
```

Native actions use stable AutomationId/name selectors where possible. Payload data is passed to the trusted bridge through an environment variable rather than interpolated into PowerShell source. Coordinate clicking is intentionally disabled in the v0.9 native driver; CDP remains available for browser/Electron workflows.

See `docs/WINDOWS_UI.md`.

## Windows install

From an extracted release:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

This copies ForgePilot to `%LOCALAPPDATA%\ForgePilot`, writes a `forgepilot.cmd` launcher, and adds that directory to the current user's PATH. It does not require Administrator privileges.

## Existing guarantees retained

- **v0.8:** persistent CDP/replay computer sessions and replayable evidence traces.
- **v0.7:** Planner/Reviewer/Verifier read-only separation; Implementer/Debugger mutation proposals only.
- **v0.6:** PNG visual verification and frozen visual baselines.
- **v0.5:** disposable Docker/Podman execution and PASS-only promotion.
- **v0.4:** AUTHOR -> RED -> IMPLEMENT -> GREEN -> REGRESSION -> BUILD.
- **v0.3:** repository intelligence and Git-scope attribution.
- **v0.2:** bounded repair and resume.
- **v0.1:** guarded execution and independent verification.

See `docs/PRODUCT_HARDENING.md`, `docs/WINDOWS_UI.md`, `docs/COMPUTER_CONTROL.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`.
