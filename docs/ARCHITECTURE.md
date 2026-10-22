# ForgePilot v0.4 Architecture

```text
Task / Goal
    |
    v
Repository Intelligence
    |-- project/framework detection
    |-- source-context ranking
    |-- test inventory / targeted selection
    |-- build/test command discovery
    v
Planner (Scripted or Ollama)
    |
    +------------------------------+
    | test-first task?             |
    |                              |
    | yes                          | no
    v                              |
Test Authoring                     |
    |                              |
Test-only Policy                   |
    |                              |
RED Gate                           |
    | false green / wrong RED -> FAIL
    v                              |
Protected Test Snapshot            |
    +--------------+---------------+
                   v
             Guarded Executor
                   |
           failure evidence
                   |
                   v
             Bounded Repair
                   |
                   v
           Independent Verifier
            |      |       |
        test gates |    Git diff
        integrity  |    scope
                   |
                   v
             Evidence Report
```

## Trust boundaries

### Planner
May propose actions and verification checks. It cannot directly write files, run processes, or declare success.

### Executor
Applies allowlisted, structured actions inside the workspace. It does not accept arbitrary shell strings.

### Test-first controller
Owns RED/green sequencing. It rejects implementation until RED evidence is valid, freezes authored test files after RED, and refuses implementation/repair edits to those files.

### Verifier
Reruns explicit checks and v0.4 engineering gates from actual repository/process state. Planner confidence is ignored.

### Git attribution
A pre-task file-fingerprint baseline distinguishes task-introduced modifications from pre-existing dirty work. Internal `.forgepilot/` artifacts are excluded.

## Test-first plan

The planner may add a `testFirst` object containing `testActions`, RED/GREEN command specifications, and optional regression/build gates. Repository discovery fills omitted regression/build gates when safe.

The controller records:

1. test-authoring results;
2. test-only diff policy result;
3. RED process evidence;
4. protected-test hashes;
5. implementation/repair history;
6. GREEN/regression/build verification;
7. final test-integrity evidence.

## Repair interaction

Action failures and final verification failures still use the v0.2 bounded repair mechanism. In test-first mode, protected test paths are excluded from legal repair edits. A repair that attempts to rewrite a RED-proven test fails closed.

## Coverage

Coverage is read after execution from known LCOV/coverage-summary artifacts. It is report evidence, not model-authored metadata.

## Current isolation limitation

v0.4 host execution is guarded but not sandboxed. Running a project's tests/build can execute arbitrary project code with the current user's host permissions. v0.5 introduces disposable Docker/Podman execution providers, resource limits, network policy, snapshots, and rollback.
