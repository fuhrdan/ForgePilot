# Product Hardening (v0.9)

ForgePilot v0.9 turns the engineering prototype into a product candidate without weakening the execution boundaries built in v0.1-v0.8.

## Approval model

Approval categories are optional and task-scoped. If a task declares a category in `permissions.require`, a matching CLI/task grant is required before the capability executes. Categories are checked at execution time so repair actions and verification commands cannot bypass them.

`--approve-all` means "grant all categories this task requires"; it does not mean unrestricted shell, network, filesystem, GUI, or agent access.

## Secret model

Secrets are aliases mapped to environment variables. The alias is safe to persist; the resolved value is transient. ForgePilot redacts every resolved value it knows from command results before those results reach reports/checkpoints.

Recommended pattern:

```json
{
  "secrets": { "token": { "env": "SERVICE_TOKEN" } },
  "permissions": { "require": ["secret_use"] }
}
```

## Recovery

Two layers exist:

1. `.forgepilot/state/<task>.json` — resumable engineering state from v0.2.
2. `.forgepilot/recovery/<task>.json` — operational lifecycle journal added in v0.9.

A stale journal indicates that a process marked itself running but its PID no longer exists. `forgepilot recover` surfaces these records; `--resume` remains the explicit recovery action.

## Provenance

ForgePilot signs the exact bytes of `report.json` with Ed25519 after the report is written. `provenance.json` records its SHA-256, signature, public key and key fingerprint. Changing even one byte in the report makes verification fail.

Self-contained provenance detects tampering. Supplying `--public-key` additionally establishes that the report was signed by the expected local ForgePilot identity.

## Profiles

Profiles only supply defaults. Explicit task/CLI settings win. `auto` chooses from detected RAM/CPU:

- low-resource: small local model/context and conservative retry budgets;
- balanced: default workstation profile;
- high-quality: larger local coding model/context and larger bounded review/repair budgets.

## Dashboard

The dashboard is deliberately loopback-only in v0.9. It reads local run reports and verifies their detached provenance. It has no mutation endpoint.
