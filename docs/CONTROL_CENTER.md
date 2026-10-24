# ForgePilot v0.11 Local Control Center

The one-click launcher opens a loopback-only browser UI. It is intended to remove the need to hand-author task JSON for normal engineering jobs.

## Normal workflow

1. Double-click the ForgePilot desktop shortcut.
2. Enter an existing repository/workspace path.
3. Enter the goal in plain English.
4. Click **Analyze repository** to inspect detected languages/frameworks, build/test commands, and relevant file names.
5. Choose an autonomy preset.
6. Approve only the capabilities the job needs. File writes and local commands are selected by default; computer control, external network, secrets, and sandbox networking are not.
7. Optionally enable the disposable sandbox when Docker/Podman is available.
8. Click **Start verified job**.
9. Watch the phase and recent logs. The final status includes whether the JSON report has valid signed provenance.

## Autonomy presets

- **Safe:** no multi-agent team, one repair, no review rounds.
- **Standard:** uses the machine-adaptive model, repair, and review settings chosen during v0.10 setup.
- **Thorough:** enables the agent team, up to three repairs, and two review rounds.

Autonomy does not grant extra capabilities. Capability approval and autonomy are independent controls.

## Security boundary

The server binds only to loopback. A random control token is generated for each dashboard launch and is required on every mutating API call. UI-generated tasks list every sensitive category under `permissions.require`; only checked capabilities are passed to the run as grants. Commands are still executed by ForgePilot's structured allowlisted executor, not by a shell.

The dashboard also sends `frame-ancestors 'none'` / `X-Frame-Options: DENY`, uses `no-store` for local API data, and refuses to read a job report outside that job's workspace.

## Low-resource behavior

The control center inherits the persisted v0.10 machine profile. Safe/Standard modes do not increase model size or context beyond those machine defaults. On minimal/low-resource systems, Standard keeps the multi-agent team disabled when the machine profile says to do so.
