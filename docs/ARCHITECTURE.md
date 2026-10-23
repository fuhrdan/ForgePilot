# ForgePilot v0.8 Architecture

```text
Task / Goal
    |
Repository Intelligence
    |
Planner [read-only]
    |
Implementer [mutation proposals]
    |
    +------------------+
    |                  |
Guarded Executor   ComputerSession
    |              /            \
Host/Sandbox     Replay          CDP
    |                         browser / Electron / IDE
    |                              |
    |                    accessibility + input + PNG
    +---------------+--------------+
                    |
Reviewer [read-only]
                    |
Tests / Build / Git / Visual / UI-state evidence
                    |
Verifier [read-only]
                    |
Debugger on bounded failure
                    |
PASS / promotion / report
```

## Trust boundaries

The orchestrator owns budgets, PASS/FAIL, evidence, protected test/baseline hashes, role policy, and session policy. Agents do not execute code or UI operations directly.

The `ComputerSession` owns one persistent GUI connection for the task. It validates actions, validates current target origin when the driver can expose it, sequences actions, redacts sensitive typing, writes screenshots, and persists a replayable trace.

The CDP driver contains only browser/Electron protocol operations; it does not expose arbitrary JavaScript evaluation as an agent action. CSS-selector lookup is generated internally for bounded click/type operations.

Real computer control is kept out of v0.8 sandbox mode because an IDE connected to the host repository is outside the disposable filesystem boundary. This is a deliberate fail-closed boundary, not an implicit host escape.
