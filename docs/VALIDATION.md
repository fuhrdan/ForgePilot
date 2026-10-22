# ForgePilot v0.4 Validation

Validated in the build environment on 2026-10-22 with Node.js 22.

## Automated suite

```bash
npm test
```

Release-candidate result: **26 passed, 0 failed**.

The v0.1–v0.3 regressions remain green and cover workspace containment, allowlisted execution, Ollama plan parsing, surgical patches, repair/retry, checkpoints/resume, repository detection/context, and Git-diff verification.

v0.4 adds tests proving:

1. Test inventory and goal-aware targeted Node test selection.
2. A valid RED → implementation → GREEN → regression → build lifecycle.
3. A test that is already green blocks implementation.
4. A test that fails for the wrong expected reason blocks implementation.
5. A missing/blocked runner does not count as RED.
6. Implementation cannot edit a RED-proven test.
7. GREEN failure can enter bounded repair while protected tests remain unchanged.
8. LCOV summaries are ingested from real artifacts.

## Command-environment regression

During development, nested `node --test` processes inherited Node's parent `NODE_TEST_CONTEXT` test-harness variable. That could make repository test execution behave differently while ForgePilot itself was under test. `runCommand` now removes that internal parent-harness variable from child execution environments. The test-first suite then passed under the real `npm test` runner.

## Release acceptance

Before packaging, the release is required to pass:

- all automated tests;
- syntax checks for every `.js` source/test file;
- CLI `--version` check;
- repository `analyze` smoke test;
- end-to-end test-first CLI smoke test in a temporary Git repository;
- clean ZIP extraction followed by another full `npm test` run.

## End-to-end CLI smoke test

A clean copy of `examples/test-first-project` was initialized as a Git repository, committed, and its task was run through the public CLI with `enforceGitScope=true`.

Observed result:

```text
Result: PASS
RED: PASS (expected failure signature matched)
GREEN: PASS
REGRESSION: PASS
BUILD: PASS
Git scope: PASS
Test integrity: PASS
Changed files:
  modified src/math.js
  added    test/math.test.js
Unexpected changed files: 0
```

The Markdown report independently recorded the RED evidence, engineering gates, Git attribution, and immutable-test check.
