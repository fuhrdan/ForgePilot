# ForgePilot v0.4.0

**A local-first software-engineering agent that proves its changes with executable evidence.**

ForgePilot plans guarded edits, executes real tools, captures failures, performs bounded repairs, and runs an independent verifier. v0.4 adds a test-first engineering pipeline: a regression test is authored before implementation, ForgePilot proves it is RED, freezes that test, then requires GREEN/regression/build evidence before declaring success.

## Requirements

- Node.js 22+
- Git recommended
- Ollama optional for local-AI planning/debugging

No npm runtime dependencies are required.

## Quick start

```powershell
npm test
node src/cli.js doctor
node src/cli.js analyze . --goal "improve test-first engineering"
```

Run a normal deterministic task:

```powershell
node src/cli.js run examples/hello-task.json --workspace .\work\hello --apply
```

Run the test-first demo on a copy of the included fixture:

```powershell
Copy-Item -Recurse examples\test-first-project .\work\test-first
node src/cli.js run .\work\test-first\task.json `
  --workspace .\work\test-first `
  --apply
```

The expected lifecycle is:

```text
AUTHOR test
   ↓
RED (must fail for expected reason)
   ↓
freeze RED-proven test
   ↓
IMPLEMENT
   ↓
GREEN targeted test
   ↓
REGRESSION suite
   ↓
BUILD
   ↓
independent verification / Git scope / test integrity
   ↓
PASS
```

Omit `--apply` to inspect a plan without modifying the workspace.

## What's new in v0.4

### Test inventory and targeted selection

Repository intelligence now recognizes conventional tests across JavaScript/TypeScript, Python, Go, Java, C#, Godot, and generic `test/`, `tests/`, and `spec/` layouts.

Tests are ranked using the task goal and the implementation paths the plan intends to change. Where safe to derive directly, ForgePilot creates targeted commands for Node's built-in test runner and `pytest`. Repository-level test/build commands remain regression/build gates.

`analyze` now shows testing information:

```text
Testing:
  - Test files: 9
  - Selected tests: test/auth-session.test.js
  - Targeted gate: node --test test/auth-session.test.js
  - Regression gate: npm test
```

### Real RED evidence

A non-zero exit code alone is not always meaningful. v0.4 distinguishes:

- **false green** — test already passes before implementation;
- **infrastructure failure** — runner missing/blocked/timed out;
- **wrong RED reason** — test failed, but expected failure text did not appear;
- **valid RED** — test ran and failed for the expected reason.

Optional RED signatures:

```json
{
  "red": {
    "command": "node",
    "args": ["--test", "test/math.test.js"],
    "failureIncludes": "Expected values to be strictly equal"
  }
}
```

`stdoutIncludes` and `stderrIncludes` are also supported.

### Test-only authoring policy

Before RED, `testActions` may modify only recognized test paths or explicitly allowed test paths. Implementation does not begin until the test-authoring phase passes policy checks.

### RED-proven tests become immutable

After valid RED evidence, ForgePilot snapshots the authored test files. Implementation and repair actions cannot modify them, and the final verifier hashes them again.

That prevents this failure mode:

```text
hard test fails
    ↓
agent weakens assertion
    ↓
"PASS"
```

ForgePilot instead fails the run if a RED-proven test changes.

### Engineering gates

In test-first mode, ForgePilot adds executable verification gates:

- GREEN targeted test;
- regression suite when discovered/supplied;
- build gate(s) when discovered/supplied;
- independent task checks;
- test-integrity check;
- Git-scope check when enabled.

GREEN/regression/build failures enter the existing bounded repair loop. Repairs may change implementation code but not RED-proven tests.

### Coverage ingestion

If present, ForgePilot reads:

```text
coverage/lcov.info
lcov.info
coverage/coverage-summary.json
coverage-summary.json
```

Line/function/branch/statement summaries are included in the report. Coverage is informational in v0.4 and is never fabricated.

## Test-first task format

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
  ],
  "verify": [
    {
      "type": "file_contains",
      "path": "src/math.js",
      "text": "return a + b;"
    }
  ]
}
```

If `regression` or `build` are omitted, ForgePilot uses safely discovered repository commands where possible.

See `docs/TEST_FIRST.md` for the full contract.

## Repository intelligence

v0.3 capabilities remain:

- Git-native / `.gitignore`-aware scanning;
- ecosystem/framework detection;
- goal-aware token-budgeted source context;
- build/test/lint command discovery;
- Git baseline fingerprinting;
- expected/unexpected changed-file attribution;
- `git_diff` verification.

Supported ecosystems include Node/TypeScript, .NET, Maven/Gradle Java, Python, Go, Rust, Godot, and generic C/C++.

Analyze a repository:

```powershell
node src/cli.js analyze C:\code\my-app `
  --goal "fix session expiration handling" `
  --max-context-tokens 4000
```

## Autonomous repair

The v0.2 bounded repair loop remains active:

```text
failure evidence
      ↓
debugger
      ↓
small repair
      ↓
retry / re-verify
      ↓
PASS or repair budget exhausted
```

Use:

```powershell
--max-repairs 3
```

Resume a checkpointed task:

```powershell
node src/cli.js run task.json --workspace .\repo --resume --max-repairs 3 --apply
```

v0.4 checkpoints preserve test-first RED evidence and the protected-test snapshot as well as the original Git baseline.

## Guarded actions

Supported implementation/repair actions:

- `write_file`
- `replace_text`
- `run_command`

Commands use `spawn(..., shell: false)` and an executable allowlist:

```text
node npm npx git python python3 pytest
 go java javac mvn gradle dotnet cargo rustc godot godot4
```

The child environment also removes Node's parent test-harness control variable so a ForgePilot test run cannot accidentally inherit the harness state of ForgePilot's own tests.

## Independent verification

Supported explicit checks:

- `file_exists`
- `file_contains`
- `command`
- `git_diff`

v0.4 additionally injects internal `test_gate` and `test_integrity` checks for test-first tasks.

The planner cannot mark a verifier check successful. Real file/process/Git evidence determines the result.

## Ollama

Example:

```powershell
node src/cli.js run examples/ollama-task.json `
  --planner ollama `
  --model qwen2.5-coder:7b `
  --max-repairs 3 `
  --apply
```

The Ollama planner now receives repository testing metadata and understands the v0.4 test-first plan shape. It is instructed to author tests separately from implementation and not modify RED-proven tests during repair.

## Reports

Every applied run writes JSON and Markdown evidence under:

```text
.forgepilot/runs/<timestamp>/
```

A v0.4 test-first report includes:

- repository/project detection;
- selected test inventory;
- test-authoring actions;
- RED command, result, and reason;
- implementation and repair history;
- GREEN/regression/build gate results;
- test-integrity result;
- coverage summary if available;
- Git change attribution and unexpected files.

Repository source excerpts used for planning remain transient and are not copied into normal reports.

## Safety model

ForgePilot v0.4 is still intentionally conservative:

- plan-only unless `--apply` is supplied;
- workspace path containment;
- no shell command strings;
- executable allowlist;
- bounded repairs;
- exact patch occurrence guards;
- test-only authoring phase;
- false-green/wrong-RED protection;
- immutable RED-proven tests;
- independent verification;
- optional Git scope enforcement.

**Important:** v0.4 is not a hardened security sandbox. Allowed interpreters, compilers, test runners, and repository code still execute on the host. Disposable Docker/Podman isolation is the v0.5 milestone.

## Roadmap

- **v0.1** guarded execution ✅
- **v0.2** bounded autonomous repair ✅
- **v0.3** repository intelligence ✅
- **v0.4** test-first engineering ✅
- **v0.5** disposable sandbox providers
- **v0.6** screenshot / visual verification
- **v0.7** multi-agent roles
- **v0.8** IDE/browser computer use
- **v0.9** UI/installer/security hardening
- **v1.0** verified autonomous software engineer
