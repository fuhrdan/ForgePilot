# ForgePilot v0.2.0

**A local-first AI software-engineering orchestrator that must prove its work — and can now repair its own failures.**

ForgePilot is moving from "LLM writes code" toward:

`goal → plan → guarded actions → run/test → failure evidence → bounded repair → retry → independent verification → evidence`

v0.2 adds the first autonomous debugging loop. A failed command or failed final verification can be fed back to the planner as structured evidence. ForgePilot then applies a bounded repair, reruns the failed step, and records the entire failure/repair history instead of hiding it.

## Requirements

- Node.js 22+
- Git
- Optional: Ollama plus a coding model such as `qwen2.5-coder:7b`
- Optional language toolchains required by the repository being worked on

ForgePilot v0.2 has no runtime npm dependencies.

## Install locally

```bash
npm install
npm link
forgepilot doctor
```

On Windows PowerShell, the same commands work once Node.js is on `PATH`.

## Try the new repair loop

```bash
node src/cli.js run examples/repair-task.json --workspace ./work/repair-demo --apply
```

The example intentionally creates a broken Node program, observes the non-zero exit code, applies a surgical `replace_text` patch, retries the exact failed command, and independently verifies the repaired runtime output.

Expected summary:

```text
Repair attempts used: 1/2
Result: PASS
```

The Markdown report preserves both the initial failure and successful retry.

## Plan-only remains the default

```bash
node src/cli.js run examples/repair-task.json --workspace ./work/repair-demo
```

No actions or repairs are applied without `--apply`.

## Local Ollama mode

Make sure Ollama is running and the model is installed:

```bash
node src/cli.js run examples/ollama-task.json \
  --planner ollama \
  --model qwen2.5-coder:7b
```

Authorize generated actions and up to three repair attempts:

```bash
node src/cli.js run examples/ollama-task.json \
  --planner ollama \
  --model qwen2.5-coder:7b \
  --max-repairs 3 \
  --apply
```

On Windows PowerShell, use backticks or place the command on one line.

## Resume a failed task

ForgePilot checkpoints applied runs under `.forgepilot/state/`.

If a run exhausts its repair budget or is interrupted after a checkpoint, continue the same task with:

```bash
node src/cli.js run my-task.json --workspace ./work/myrepo --resume --max-repairs 4 --apply
```

The task ID is derived from the task file path and goal. Use the same task file and workspace when resuming.

## Work on an existing repository

```bash
node src/cli.js clone https://github.com/OWNER/REPO.git ./work/myrepo
```

Then run a task against it:

```bash
node src/cli.js run my-task.json \
  --workspace ./work/myrepo \
  --planner ollama \
  --model qwen2.5-coder:7b \
  --apply
```

## v0.2 repair behavior

ForgePilot can repair two failure classes:

1. **Action failure** — for example, compilation, tests, or a program command exits unexpectedly. ForgePilot sends the command evidence to the debugger, executes repair actions, then reruns the exact failed action.
2. **Verification failure** — all implementation actions finished, but an independent verification check fails. ForgePilot sends only the failed checks as evidence, repairs, and reruns the verifier.

The default repair budget is two attempts per task invocation/state. Change it with `--max-repairs N`.

## Surgical patches

v0.2 adds `replace_text`:

```json
{
  "type": "replace_text",
  "path": "src/app.js",
  "find": "return wrongValue;",
  "replace": "return correctValue;",
  "expectedOccurrences": 1
}
```

The occurrence guard prevents ambiguous bulk replacement. If the exact expected number of matches is not found, the repair action fails rather than guessing.

## Safety model

ForgePilot still does **not** give the planner an unrestricted shell.

- Plan-only unless `--apply` is supplied.
- Commands are spawned directly with `shell: false`.
- Executables must be on the ForgePilot allowlist.
- Writes and patches are rejected if their paths escape the workspace.
- `replace_text` can require an exact occurrence count.
- Repair attempts have a hard budget.
- Planner success claims are ignored; the verifier decides success.
- Reports preserve failures, repairs, retries, and final verification evidence.

This is a guarded host executor, **not yet a hardened sandbox**. v0.5 remains the milestone for disposable container/VM execution with resource and network policies.

## Commands

```text
forgepilot init <workspace>
forgepilot doctor
forgepilot clone <git-url> <workspace>
forgepilot run <task.json> [--workspace PATH]
                           [--planner scripted|ollama]
                           [--model MODEL]
                           [--ollama-url URL]
                           [--max-repairs N]
                           [--resume]
                           [--apply]
```

## Task repair fixture

Scripted tasks can define deterministic `repairs[]`; this is mainly useful for tests and reproducible demos. Ollama tasks generate repair plans dynamically from observed failure evidence.

```json
{
  "goal": "Build and verify something",
  "actions": [],
  "verify": [],
  "repairs": [
    {
      "rationale": "First deterministic repair",
      "actions": []
    }
  ]
}
```

## Road to 1.0

- **v0.1** — guarded local execution and independent verification ✅
- **v0.2** — evidence-driven repair loop, surgical patches, checkpoint/resume ✅
- **v0.3** — repository intelligence
- **v0.4** — test-first agent
- **v0.5** — disposable sandboxes
- **v0.6** — screenshot and visual verification
- **v0.7** — Planner / Implementer / Debugger / Reviewer / Verifier roles
- **v0.8** — IDE/browser computer use
- **v0.9** — dashboard, installer, model/security hardening
- **v1.0** — evidence-backed autonomous software engineering

See [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
