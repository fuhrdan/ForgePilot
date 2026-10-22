# v0.3 Validation

Validated in the build environment on 2026-10-22 with Node.js v22.x.

## Automated tests

```bash
npm test
```

Release result: **18 passed, 0 failed**.

The original v0.1/v0.2 regression tests remain and cover:

- workspace path containment;
- plan-only behavior;
- guarded file writes;
- shell/executable blocking;
- Ollama structured-plan parsing;
- exact `replace_text` patches;
- ambiguous-patch failure;
- real process failure → repair → retry;
- verification-triggered repair;
- repair-budget enforcement;
- checkpoint resume.

v0.3 adds tests proving:

1. Filesystem scanning honors root `.gitignore` and built-in generated-directory exclusions.
2. Git-backed scanning delegates ignore behavior to Git.
3. Node/TypeScript/framework detection and build/test hints work.
4. Goal-relevant source is selected within the requested context budget.
5. Git baseline comparison separates expected from unexpected changed files.
6. `git_diff` verification fails on an unrelated repository change.

## Repository-analysis smoke test

```bash
node src/cli.js analyze . \
  --goal "improve repository intelligence and git diff verification" \
  --max-context-tokens 1200
```

Observed result:

```text
ForgePilot v0.3.0 repository analysis
Files: 32 (filesystem)
Context: ~1200/1200 tokens across 3 files
Detected projects:
  - node: JavaScript
Suggested commands:
  - test: npm test
Selected AI context:
  - src/repository/git-diff.js
  - package.json
  - README.md
```

This verifies the user-facing analyzer and demonstrates goal-sensitive ranking rather than README-only context selection.


## End-to-end Git-scope smoke test

A temporary Git repository was initialized with a committed `app.js`. ForgePilot captured the baseline, patched only `app.js`, executed it, reran it through independent verification, and enforced both an explicit `git_diff` check and task-level `enforceGitScope`.

Observed result:

```text
Result: PASS
changedFiles:
  app.js (modified)
unexpectedFiles: 0
```

The first smoke-test attempt exposed an internal-artifact attribution bug: `.forgepilot/state/...` was being seen by Git's untracked-file listing. v0.3 was corrected to apply ForgePilot's built-in internal/generated exclusions to the Git-backed scanner as well. The fixed path is covered by the Git scanner test and the repeated CLI smoke test passed.

## Release acceptance criteria

- Existing repair workflow remains green.
- Repository analysis does not modify source files.
- Planner context can contain source excerpts but persistent reports do not.
- Explicit Git change-scope verification is independently evaluated.
- Pre-task Git baseline is checkpointed for resume.
- No npm runtime dependencies were added.
