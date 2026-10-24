# ForgePilot v0.12 Local Control Center

The one-click launcher opens a loopback-only browser UI. v0.12 turns the v0.11 job form into a persistent project/recipe/task-queue workspace so normal daily use does not require hand-authored task JSON.

## Normal workflow

1. Double-click the ForgePilot desktop shortcut.
2. Choose a saved project or enter an existing repository/workspace path.
3. Optionally save the repository with default recipe/autonomy/approval/sandbox settings.
4. Choose a built-in/custom recipe or use the human goal exactly as written.
5. Enter the goal in plain English.
6. Click **Analyze repository** to inspect detected languages/frameworks, build/test commands, and relevant file names.
7. Approve only the capabilities the job needs.
8. Optionally enable the disposable sandbox when Docker/Podman is available.
9. Click **Start verified job**. The job enters the FIFO queue.
10. Watch queued/running phase and recent logs. The final status includes signed JSON provenance.

## Saved projects

Projects store only control-center metadata: repository path, display name, default recipe, autonomy, approval categories, and sandbox preference. Removing a saved project never deletes the repository.

See `PROJECT_WORKSPACES.md` for state paths and persistence behavior.

## Reusable recipes

Built-ins:

- Fix bug — test first
- Add feature
- Review repository
- Prepare release

Custom recipes can be saved from the control center. Built-ins are immutable. Recipe defaults do not bypass approvals or other ForgePilot safety boundaries.

## Persistent task queue

The default concurrency is one job. This protects low-resource machines from running multiple local coding-model workloads simultaneously.

The control center can:

- pause/resume the whole queue;
- pause/resume an individual job before it starts;
- cancel queued, paused, or running jobs;
- retry a terminal/interrupted job with an auditable `retryOf` link.

ForgePilot intentionally does not claim that a running Windows process can be safely suspended and resumed. Running jobs are cancelled/retried rather than fake-paused.

## Autonomy presets

- **Safe:** no multi-agent team, one repair, no review rounds.
- **Standard:** uses the machine-adaptive model, repair, and review settings chosen during setup.
- **Thorough:** enables the agent team, up to three repairs, and two review rounds.

Autonomy does not grant extra capabilities. Capability approval and autonomy are independent controls.

## Security boundary

The server binds only to loopback. A random control token is generated for each dashboard launch and is required on every mutating API call, including project/recipe/queue changes. UI-generated tasks list every sensitive category under `permissions.require`; only checked capabilities are passed to the run as grants. Commands are still executed by ForgePilot's structured allowlisted executor, not by a shell.

The dashboard also sends `frame-ancestors 'none'` / `X-Frame-Options: DENY`, uses `no-store` for local API data, and refuses to read a job report outside that job's workspace.

## Restart behavior

Queue state is persisted. Queued/paused jobs survive a dashboard restart. A job recorded as running when the dashboard process disappears is marked `interrupted` on the next launch, because ForgePilot cannot safely assume the old child process completed successfully.

## Low-resource behavior

The control center inherits the persisted machine-adaptive profile. The queue's default single-job concurrency is an additional v0.12 protection against local LLM memory contention.
