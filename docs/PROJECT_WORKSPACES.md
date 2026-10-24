# ForgePilot v0.12 Project Workspaces, Recipes, and Queue

v0.12 turns the browser control center into a persistent daily-driver workspace.

## Saved projects

A saved project records only ForgePilot control metadata:

- display name;
- absolute repository path;
- default recipe;
- Safe / Standard / Thorough autonomy preference;
- explicitly granted capability categories;
- sandbox preference.

The registry is stored under the launcher workspace at:

```text
.forgepilot/dashboard/projects.json
```

Saving or deleting a project does not alter or delete the repository itself.

## Recipes

ForgePilot ships four reusable workflows:

- `fix-bug-test-first`;
- `add-feature`;
- `review-repository`;
- `prepare-release`.

Recipes wrap the human goal with reusable engineering instructions and provide default autonomy/approval/sandbox settings. Built-ins are immutable. Custom recipes are stored at:

```text
.forgepilot/dashboard/recipes.json
```

A recipe never bypasses capability approvals, command allowlists, Git-scope checks, agent-role separation, or sandbox/origin policy.

## Persistent FIFO task queue

Dashboard jobs now enter a FIFO queue. The default concurrency is one job so a low-resource workstation does not accidentally run multiple local LLM coding jobs at once.

Queue state is persisted at:

```text
.forgepilot/dashboard/queue.json
```

Supported controls:

- pause/resume the whole queue;
- pause/resume a queued job;
- cancel a queued/paused/running job;
- retry a finished, failed, cancelled, or interrupted job.

ForgePilot does **not** pretend to suspend an already-running Windows process. Per-job pause is intentionally limited to jobs that have not started. A running job can be cancelled, then retried.

## Restart behavior

When the dashboard restarts:

- queued jobs remain queued;
- paused jobs remain paused;
- completed results remain visible;
- a job that had been `running` is changed to `interrupted` because its child process can no longer be trusted to exist;
- the interrupted job can be retried with an auditable `retryOf` link.

## Built-in recipe intent

### Fix bug — test first

Reproduce the bug with a regression test when possible, apply the smallest fix, run targeted and broader verification, and check Git scope.

### Add feature

Inspect the existing architecture, add/update tests, implement the focused feature, then run tests/build/review/scope verification.

### Review repository

Read-only review. The default recipe grants only local command execution and instructs the agent not to mutate source.

### Prepare release

Run local release checks, fix bounded issues, prepare local artifacts, and verify readiness without pushing or publishing externally.
