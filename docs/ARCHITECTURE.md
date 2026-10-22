# ForgePilot v0.1 Architecture

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
+-------------+        +------------------+
|  Executor   |------->| Guarded Workspace|
+-------------+        +------------------+
      |                         |
      | evidence                | resulting state
      v                         v
+------------------------------------------+
|          Independent Verifier            |
| file existence / contents / commands/Git |
+------------------------------------------+
      |
      v
JSON + Markdown evidence report
```

## Trust boundaries

The planner is **not trusted** to declare success. Its output is treated as a proposal.
The executor enforces path and command restrictions. The verifier reads the resulting state
and reruns checks after the executor is finished.

v0.1 is intentionally not a hardened sandbox. Host execution is guarded, but a permitted
compiler/runtime can still execute repository code. Disposable container/VM providers are a
planned v0.5 boundary.

## Planner contract

A planner returns:

- `goal`
- `rationale`
- `actions[]`
- `verify[]`

The Ollama adapter asks the model for JSON and validates the structural minimum before the
plan reaches the executor.

## Executor contract

Supported v0.1 actions:

- `write_file`
- `run_command`

All writes pass through `resolveInside()`. Commands are started directly via `spawn()` with
`shell: false` and must use an allowlisted executable.

## Verifier contract

Supported v0.1 checks:

- `file_exists`
- `file_contains`
- `command`

The verifier also captures Git repository, branch, and working-tree status for the report.
