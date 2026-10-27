# ForgePilot v0.17.0

**A local-first verified software-engineering agent with one-click Windows setup, adaptive low-resource operation, and one universal natural-language prompt.**

ForgePilot v0.17 removes the separate project/recipe/build/review screens from the normal UI. The browser control center now presents one prompt box: describe what you want done, including an existing project path when relevant, and ForgePilot infers whether to create a new project, modify/fix an existing repository, run verification, perform a read-only review, package/release, or use UI/browser control.

## Windows: one-click install and run

1. Extract the release ZIP.
2. Double-click **`INSTALL_FORGEPILOT.cmd`** once.
3. Double-click the **ForgePilot** Desktop shortcut for normal use.

The v0.14+ adaptive resource governor remains intact: ForgePilot inspects RAM/available RAM, CPU, GPU/VRAM, disk, tools, and local Ollama models, then selects a conservative model/context/repair plan. Under pressure it can downgrade to smaller installed models; it never silently scales above the configured plan.

## v0.17 Universal Prompt

The default UI is intentionally one screen and one entry field:

```text
ForgePilot

What do you want ForgePilot to build, fix, review, test, or run?
[ one natural-language prompt ]

[ DO IT ]
```

Examples:

```text
Build a C# desktop app that finds duplicate files and includes a Windows launcher.

Fix the login retry bug in C:\Projects\MyApp and add a regression test.

Review C:\Projects\OpsForge for reliability problems.

Run the tests in C:\Projects\AnchorWeight and fix any failures.
```

If the prompt contains an existing path, ForgePilot uses that workspace. If no existing path is supplied, it creates a new project automatically under `ForgePilot Workspace/Projects/`. Paths containing spaces can be quoted.

The prompt router infers a conservative capability set. Read-only reviews receive no mutation/command grants; verification-only requests receive command execution; build/fix requests receive local file-write + command execution; computer/network/secrets capabilities are granted only when the prompt explicitly implies them. The underlying task still marks all sensitive capability categories as approval-gated, so unexpected escalation fails closed.

The v0.16 watchdog behavior remains: 2-minute model response limit, 5-minute no-progress stop, 30-minute overall simple/universal-job ceiling, bounded repairs, visible progress heartbeats, and smaller-model fallback. Multi-agent orchestration remains off on the default path for low-resource reliability.

CLI equivalent:

```powershell
forgepilot prompt "Fix the retry bug in C:\Projects\MyApp and add a test"
```

`forgepilot build` remains an alias for backward compatibility.

## v0.16 Just Build It

v0.16 introduced description-first automatic project creation, one-agent default execution, hard model/no-progress/overall watchdogs, visible progress, and bounded model fallback. v0.17 keeps that execution model but generalizes the single prompt beyond only building new software.

## v0.15 evidence confidence and patch review

Every executed run now includes a deterministic evidence-confidence assessment in the signed `report.json` and Markdown report. The score is an auditable summary of verification evidence, **not** a probability that the code is bug-free. It rewards independent verification, test-first evidence, Git-scope checks, read-only Verifier approval, visual checks, coverage, and low repair counts while surfacing explicit evidence gaps.

The dashboard adds a conservative post-run adjustment using signed provenance, preflight risk, finalized rollback/checkpoint evidence, change-set size, and sensitive-path changes. Job cards show both the confidence level and a patch-review summary.

Patch review stores metadata only: per-file add/modify/delete state, before/after byte counts, text/binary status, estimated line deltas, and path sensitivity. It does not persist source-file contents. Large/binary files are summarized without decoding them, keeping the feature useful on low-resource machines.

Advanced CLI inspection:

```powershell
forgepilot assess .forgepilot\runs\<run>\report.json
```

## v0.14 adaptive runtime health and fallback

ForgePilot now re-checks **current** memory headroom immediately before each dashboard AI job instead of relying only on the install/launch-time profile. It only downgrades under pressure; it never silently scales a job up beyond the configured machine plan.

- Critical headroom below 1.25 GiB blocks the AI job before it can thrash the machine.
- A balanced configuration can temporarily fall back to low-resource/minimal context, repair budget, review rounds, and single-agent behavior when free RAM drops.
- ForgePilot asks only the local Ollama endpoint which models are already installed and prefers a compatible smaller installed model when the preferred model is unavailable.
- Ollama planner calls have a bounded fallback chain for retryable local-runtime failures such as model-not-found, server-busy, or memory-related 5xx failures.
- `forgepilot health [workspace]` performs a local self-test for Node, workspace access, memory headroom, and optional Ollama availability.
- The one-click installer runs the health test automatically; the one-click launcher shows runtime health and the dashboard displays the current status/model/fallback chain.

Example fallback chain on a balanced system:

```text
qwen2.5-coder:7b
  -> qwen2.5-coder:3b
  -> qwen2.5-coder:1.5b
```

## v0.12 persistent project workspace

After installation, double-click the **ForgePilot** desktop shortcut. The browser control center now lets you:

- save repositories as named ForgePilot projects;
- persist per-project recipe, autonomy, approval, and sandbox defaults;
- choose built-in workflows for **Fix bug — test first**, **Add feature**, **Review repository**, or **Prepare release**;
- save/delete your own custom reusable recipes;
- queue multiple engineering jobs without running multiple local LLM workloads at once;
- pause/resume the whole queue;
- pause/resume jobs that have not started;
- cancel queued, paused, or running jobs;
- retry completed/failed/cancelled/interrupted jobs with an auditable `retryOf` link;
- recover queue state after a dashboard restart;
- continue to analyze repositories, choose autonomy, grant capabilities explicitly, watch live logs, and inspect signed results.

The default queue concurrency is **one job**. This is deliberate: on a low-resource workstation, two simultaneous local coding-model sessions can cause severe memory pressure and make both tasks slower or unreliable.

ForgePilot does not pretend to freeze an already-running Windows process. Per-job pause/resume is limited to queued jobs. A running job can be cancelled and retried.

Saved control-center state is stored under the launcher workspace:

```text
.forgepilot/dashboard/
    projects.json
    recipes.json
    queue.json
```

Built-in recipes cannot be overwritten or deleted. Recipes only add reusable task instructions/defaults; they never bypass approval gates, command allowlists, repository confinement, sandbox rules, agent-role separation, or provenance verification.


## v0.13 workspace safety and rollback

Before a dashboard job starts, ForgePilot now performs a **change preflight** and creates a reversible workspace checkpoint. Preflight classifies the task as low/medium/high risk using the goal, repository structure, likely context/touch points, repository size, and any pre-existing dirty Git paths. It does not grant extra permissions.

The checkpoint captures the repository state *as it exists immediately before ForgePilot runs*, including pre-existing user edits. After the run ForgePilot records exact post-run SHA-256 hashes and a change set (`added`, `modified`, `deleted`). The dashboard shows that change summary and offers **Rollback changes**.

Rollback is intentionally conflict-safe: ForgePilot restores a path only when its current hash still matches the exact post-run hash that ForgePilot recorded. If you edit a file after the job finishes, rollback is blocked for that file instead of overwriting your newer work. ForgePilot never implements this feature as `git reset --hard`.

Advanced CLI commands:

```powershell
forgepilot preflight . --goal "Migrate authentication schema"
forgepilot rollback . <checkpoint-id> --dry-run
forgepilot rollback . <checkpoint-id>
```

Dashboard jobs do not become visible as PASS until report provenance and checkpoint finalization are complete.

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

## Local control center

```powershell
node src/cli.js dashboard . --port 3210
```

The dashboard binds to `127.0.0.1`. In v0.13 it adds change-risk preflight, automatic reversible checkpoints, post-run change summaries, and conflict-safe rollback on top of the v0.12 saved-project/recipe/FIFO queue controls. The CLI remains available for advanced task JSON, secrets, computer-control, and custom-model workflows.

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

- **v0.12:** saved projects, reusable recipes, and persistent low-resource-friendly task queue.
- **v0.13:** risk preflight, reversible workspace checkpoints, exact change summaries, and conflict-safe rollback.
- **v0.11:** browser repository analysis and natural-language job control.
- **v0.10:** one-click Windows install/run and machine-adaptive low-resource defaults.
- **v0.9:** secrets, explicit approvals, signed provenance, recovery journals, profiles, and native Windows UI Automation.
- **v0.8:** persistent CDP/replay computer sessions and replayable evidence traces.
- **v0.7:** Planner/Reviewer/Verifier read-only separation; Implementer/Debugger mutation proposals only.
- **v0.6:** PNG visual verification and frozen visual baselines.
- **v0.5:** disposable Docker/Podman execution and PASS-only promotion.
- **v0.4:** AUTHOR -> RED -> IMPLEMENT -> GREEN -> REGRESSION -> BUILD.
- **v0.3:** repository intelligence and Git-scope attribution.
- **v0.2:** bounded repair and resume.
- **v0.1:** guarded execution and independent verification.

See `docs/PROJECT_WORKSPACES.md`, `docs/CONTROL_CENTER.md`, `docs/ONE_CLICK_WINDOWS.md`, `docs/PRODUCT_HARDENING.md`, `docs/WINDOWS_UI.md`, `docs/COMPUTER_CONTROL.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`.
