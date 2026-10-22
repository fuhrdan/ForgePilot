# Test-First Engineering in ForgePilot v0.4

ForgePilot v0.4 adds an evidence-backed test-first workflow. The goal is not merely to run tests after an AI edit. ForgePilot records proof that a regression test failed before implementation and passed after implementation.

## Lifecycle

```text
repository analysis
       |
       v
test inventory + targeted selection
       |
       v
AUTHOR regression test
       |
       v
test-only change policy
       |
       v
RED gate ---- false green / wrong failure ----> STOP
       |
       v
snapshot RED-proven tests
       |
       v
IMPLEMENT source change
       |
       v
GREEN targeted gate
       |
       v
REGRESSION gate
       |
       v
BUILD gate(s)
       |
       v
independent verifier + Git scope + test integrity
       |
       v
PASS / bounded repair / FAIL
```

## Task format

```json
{
  "goal": "Fix add(a, b)",
  "testFirst": {
    "testActions": [
      {
        "type": "write_file",
        "path": "test/math.test.js",
        "content": "..."
      }
    ],
    "red": {
      "command": "node",
      "args": ["--test", "test/math.test.js"],
      "failureIncludes": "Expected values to be strictly equal"
    },
    "green": {
      "command": "node",
      "args": ["--test", "test/math.test.js"]
    }
  },
  "actions": [
    {
      "type": "replace_text",
      "path": "src/math.js",
      "find": "return 0;",
      "replace": "return a + b;"
    }
  ]
}
```

`red`, `green`, `regression`, and `build` accept structured command objects. When regression/build commands are omitted, ForgePilot uses commands discovered from repository manifests where possible.

## RED evidence

A RED gate is valid only when the test process actually runs and exits non-zero. A missing executable, timeout, or blocked command is infrastructure failure, not RED.

A task can additionally prove that the test failed for the expected reason using any of:

- `failureIncludes`: search combined stdout/stderr.
- `stdoutIncludes`: require text in stdout.
- `stderrIncludes`: require text in stderr.

If the test exits successfully before implementation, ForgePilot reports a **false green** and refuses to modify implementation code.

## Test immutability

After a valid RED gate, ForgePilot hashes the authored test files. Implementation and repair actions cannot edit those files. Test integrity is checked again after actions and during final verification.

This prevents an agent from making a difficult test pass by weakening or deleting the test.

## Test discovery

Repository intelligence inventories conventional test locations/names for JavaScript/TypeScript, Python, Go, Java, C#, Godot, and generic `test/`, `tests/`, and `spec/` layouts.

ForgePilot ranks tests against the task goal and the implementation paths the plan intends to change. It can currently derive direct targeted execution for:

- Node's built-in `node --test` runner.
- Python `pytest`.

Other ecosystems still receive test inventory plus their repository-level regression command.

## Engineering gates

A successful test-first run requires:

1. Valid RED evidence.
2. GREEN targeted test gate.
3. Repository regression test gate when discovered/supplied.
4. Build gate(s) when discovered/supplied.
5. Independent task verification.
6. RED-proven test integrity.
7. Git-scope verification when requested.

Gate failures enter the existing bounded repair loop. Repairs may change implementation code but not RED-proven tests.

## Coverage

Coverage is informational in v0.4. ForgePilot ingests these artifacts when present:

- `coverage/lcov.info`
- `lcov.info`
- `coverage/coverage-summary.json`
- `coverage-summary.json`

Line/function/branch/statement summaries are written to the run report. v0.4 does not fabricate coverage and does not fail a run merely because no coverage artifact exists.
