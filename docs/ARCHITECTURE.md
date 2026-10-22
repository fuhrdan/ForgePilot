# ForgePilot v0.2 Architecture

```text
Task JSON / Goal
      |
      v
+-------------+
|   Planner   |  scripted or Ollama
+-------------+
      |
      | structured plan
      v
+-------------+        +-------------------+
|  Executor   |------->| Guarded Workspace |
+-------------+        +-------------------+
      |
      | action evidence
      |       failure
      |          |
      |          v
      |    +-------------+
      |    |  Debugger   |  planner.repair(...)
      |    +-------------+
      |          |
      |          | bounded patch actions
      |          v
      |    +-------------+
      +----| Retry Step  |
           +-------------+
                 |
                 v
+------------------------------------------+
|          Independent Verifier            |
| file existence / contents / commands/Git |
+------------------------------------------+
      |                    |
      | PASS               | FAIL
      |                    v
      |              bounded repair
      v
JSON + Markdown evidence report
      + checkpoint state
```

## Trust boundaries

The planner/debugger is **not trusted** to declare success. Its output is a proposal. The executor enforces path and command restrictions, and the verifier independently evaluates repository state and behavior.

v0.2 is still not a hardened sandbox. A permitted runtime/compiler can execute repository code on the host. Disposable container/VM providers remain the v0.5 security-boundary milestone.

## Planner contract

Initial planning returns:

- `goal`
- `rationale`
- `actions[]`
- `verify[]`

For repair, the planner receives:

- the original goal and plan;
- workspace file names and Git metadata;
- the exact failed action result **or** failed verification checks;
- the current bounded repair-attempt number.

The repair planner returns:

- `rationale`
- `actions[]`
- optional `verify[]` metadata

ForgePilot ignores claims of success and reruns the failed step or verifier itself.

## Executor contract

Supported v0.2 actions:

- `write_file`
- `replace_text`
- `run_command`

`replace_text` supports `expectedOccurrences`, which defaults to 1. The operation fails if the actual match count differs.

All writes and patches pass through `resolveInside()`. Commands are started directly via `spawn()` with `shell: false` and must use an allowlisted executable.

## Repair budget

`--max-repairs` defaults to 2. The budget is shared across action-repair and verification-repair attempts. Once exhausted, ForgePilot stops and records failure evidence rather than looping indefinitely.

## Checkpoints and resume

Applied tasks persist a state file after significant transitions:

```text
.forgepilot/state/<task-id>.json
```

State includes the original plan, next main action index, action evidence, repairs used, and last failure. `--resume` reloads that state and continues from the checkpoint.

## Verifier contract

Supported checks remain:

- `file_exists`
- `file_contains`
- `command`

The verifier also captures Git repository, branch, and working-tree status for reports.
