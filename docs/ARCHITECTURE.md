# ForgePilot v0.3 Architecture

```text
Task JSON / Goal
      |
      v
+-------------------------+
| Repository Intelligence |
| scanner / detector      |
| context / command hints |
+-------------------------+
      |
      | bounded source context
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
+---------------------------------------------+
|            Independent Verifier             |
| file / command / Git change-scope evidence  |
+---------------------------------------------+
      |                    |
      | PASS               | FAIL
      |                    v
      |              bounded repair
      v
JSON + Markdown evidence report
      + checkpoint state
```

## Repository intelligence boundary

Repository intelligence is read-only. It may inspect filenames, manifests, and selected text source files, but it does not modify the workspace.

The scanner prefers Git's own ignore implementation:

```text
git ls-files -co --exclude-standard
```

For non-Git workspaces a local fallback honors common root `.gitignore` patterns and excludes generated/system directories.

The context builder assigns relevance scores from task-goal terms, manifests, source paths, and documentation. It then reads text under an approximate token budget. The selected excerpts are sent to the planner but are not placed in normal persistent reports.

## Git attribution

Before an applied task begins, ForgePilot captures a fingerprint map of the repository's tracked/non-ignored files. The baseline is persisted in the task checkpoint.

After execution, current fingerprints are compared to the baseline, producing:

- added files;
- modified files;
- deleted files;
- unexpected files outside the approved change scope.

This design handles a dirty working tree: an existing uncommitted modification that ForgePilot does not alter has the same before/after fingerprint and is not attributed to the task.

The v0.3 implementation fingerprints up to 10,000 repository files. If that bound is exceeded, explicit `git_diff` / enforced-scope checks fail closed rather than claiming complete scope verification.

## Trust boundaries

The planner/debugger is **not trusted** to declare success. Its output is a proposal.

The executor enforces:

- workspace path containment;
- supported action types;
- executable allowlist;
- `shell: false` process execution;
- exact-match patch occurrence checks.

The verifier independently evaluates the finished state.

v0.3 remains a host-execution prototype, not a hardened sandbox. An allowlisted runtime/compiler can execute code from the repository. Disposable container/VM providers remain the v0.5 security-boundary milestone.

## Planner contract

Planning receives:

- goal;
- repository file list;
- detected projects/frameworks;
- suggested build/test commands;
- selected source excerpts under the context budget;
- Git metadata.

Initial planning returns:

- `goal`
- `rationale`
- `actions[]`
- `verify[]`

Repair receives the same current repository context plus the exact failure evidence and original plan.

## Executor contract

Supported v0.3 actions:

- `write_file`
- `replace_text`
- `run_command`

## Verifier contract

Supported checks:

- `file_exists`
- `file_contains`
- `command`
- `git_diff`

A Git change audit is also produced for reports even when it is not configured as a blocking verification check.

## Checkpoints and resume

Applied tasks persist:

```text
.forgepilot/state/<task-id>.json
```

v0.3 state version 2 adds the original Git baseline. A resumed run therefore measures all subsequent changes against the state that existed before the original task started.
