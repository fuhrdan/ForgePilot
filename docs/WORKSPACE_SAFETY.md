# ForgePilot v0.13 Workspace Safety

ForgePilot v0.13 adds a reversible safety layer around dashboard engineering jobs.

## Preflight

`forgepilot preflight <workspace> --goal "..."` inspects repository metadata, likely context files, tests/build hints, repository size, and pre-existing dirty Git paths. It returns a low/medium/high risk level with reasons. It never returns source excerpts and never grants permissions.

## Checkpoint

Immediately before a dashboard child process starts, ForgePilot snapshots the repository files visible through its ignore-aware scanner into `.forgepilot/checkpoints/<job-id>/`. The snapshot represents the user's exact pre-job state, not Git HEAD.

After execution, ForgePilot hashes the final repository and stores an exact added/modified/deleted change set. PASS is not published to the dashboard until this finalization finishes.

## Conflict-safe rollback

Before rollback, ForgePilot compares every changed file's current SHA-256 to the post-run SHA-256 recorded at finalization. If any path differs, rollback is blocked and the newer content is left untouched. If all paths still match, added files are removed and modified/deleted files are restored from the pre-job snapshot.

This deliberately avoids `git reset --hard`, which could destroy unrelated or pre-existing user work.

Use `--dry-run` first from the CLI or the dashboard's built-in preview/confirmation flow.
