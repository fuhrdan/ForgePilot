# Reliability and finished deliverables

ForgePilot v0.19 focuses on producing an obvious result or an actionable failure instead of leaving a long-running job ambiguous.

## Finished deliverables

After a verified `PASS`, ForgePilot packages output under:

```text
.forgepilot/deliverables/<task-id>/
```

If a build produces a recognized artifact such as an `.exe`, `.jar`, `.whl`, `.msi`, or release ZIP, that file is copied into the deliverable directory and becomes the primary output. Otherwise ForgePilot creates a source bundle. For Node and Python projects, the bundle includes `RUN.cmd` and `run.sh` when an entry point can be identified.

The deliverable metadata is included in the signed JSON task report.

## Local model benchmark

```powershell
forgepilot benchmark --save
```

The benchmark uses only the local Ollama endpoint and installed models. `--save` stores the fastest passing local model as the preferred machine model. A failed benchmark does not prevent ForgePilot from using its conservative hardware-derived plan.

## Diagnostics

```powershell
forgepilot diagnostics
```

The diagnostic ZIP includes runtime versions, machine resource information, tool availability, runtime health, and sanitized recent recovery state. By default it does **not** include source code, prompt contents, secrets, or repository filenames.

## Repair and update

```powershell
forgepilot repair
forgepilot update-check
forgepilot update
```

`repair` verifies required installation files and runs the local health checks. `update-check` only checks GitHub Releases. On Windows, `update` is explicit/opt-in: it downloads the published Windows ZIP and checksum, verifies SHA-256, and then invokes the same one-click installer used for a clean install. Configuration, logs, and the private runtime directory are preserved by the installer.

## Interrupted runs

Dashboard queue state survives restarts. If a job was interrupted and ForgePilot has a core state checkpoint for the same task, Retry resumes with `--resume`. If no resumable state exists, ForgePilot falls back to a clean retry in the same workspace.
