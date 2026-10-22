# v0.1 Validation

Validated in the build environment on 2026-10-22 with Node.js v22.16.0 and Git 2.47.3.

## Automated tests

`node --test`

Result: **6 passed, 0 failed**.

Coverage of behavior includes:

- child paths are accepted inside a workspace;
- `..` traversal outside the workspace is rejected;
- plan-only mode does not modify files;
- apply mode writes files and independent verification succeeds;
- a non-allowlisted shell executable is blocked;
- an Ollama-compatible HTTP response is parsed into a structured plan.

## End-to-end smoke test

Command:

```bash
node src/cli.js run examples/hello-task.json --apply
```

Result: **PASS**.

The smoke test created `hello.js`, executed it with Node, then independently verified:

1. the file existed;
2. the file contained the expected string;
3. the program exited successfully and printed the expected output.

The temporary smoke-test workspace was removed before packaging the release.
