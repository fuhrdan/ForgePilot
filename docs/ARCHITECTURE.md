# ForgePilot Architecture — v0.9

```text
Task / Goal
    |
    +--> Product profile (optional defaults)
    +--> Secret aliases -> environment only
    +--> Approval policy
    |
    v
Repository Intelligence
    |
    v
Planner [read-only]
    |
    v
Implementer [mutation proposals]
    |
    v
Guarded Orchestrator
    +--> filesystem actions (workspace-confined)
    +--> command provider (host or disposable container)
    +--> computer provider (CDP / replay / Windows UI)
    |
    v
Reviewer [read-only]
    |
    v
Test / Build / Git / Visual / UI Evidence
    |
    v
Verifier [read-only]
    |
    v
Report + Recovery Journal + Ed25519 Provenance
    |
    +--> loopback dashboard (read-only run history)
```

## Trust boundaries

The LLM never receives direct shell authority. Commands remain allowlisted and shell-free. Planner/Reviewer/Verifier remain read-only. Implementer/Debugger return proposals that pass through the executor. Optional approval categories add another execution-time gate and cannot widen existing allowlists or path/origin policies.

Secret values are resolved after planning, at execution time, from environment variables. Known resolved values are redacted before command results enter checkpoints/reports. The planner and persisted task plan retain aliases/placeholders rather than resolved values.

## Provenance

`report.json` is immutable input to the provenance step. ForgePilot hashes and signs its exact bytes with a local Ed25519 private key and writes a detached `provenance.json`. The signature is not embedded back into `report.json`, avoiding circular serialization.

## Recovery

Engineering checkpoints (`.forgepilot/state`) and operational recovery journals (`.forgepilot/recovery`) are separate. This keeps task-resume state distinct from process-lifecycle evidence.

## Native Windows control

The Windows driver is a trusted adapter, not an agent-generated PowerShell channel. ForgePilot owns a fixed bridge program; JSON action payloads travel through an environment variable. The bridge uses .NET UI Automation and refuses native coordinate clicks in v0.9.
