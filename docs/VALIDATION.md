# v0.2 Validation

Validated in the build environment on 2026-10-22 with Node.js v22.16.0.

## Automated tests

```bash
npm test
```

Result: **12 passed, 0 failed**.

Coverage includes:

- workspace child paths are accepted;
- `..` traversal outside the workspace is rejected;
- plan-only mode does not modify files;
- apply mode writes files and independent verification succeeds;
- a non-allowlisted shell executable is blocked;
- an Ollama-compatible HTTP response is parsed into a structured plan;
- `replace_text` successfully applies an exact surgical patch;
- ambiguous `replace_text` operations fail closed;
- a real failed Node process is patched and retried successfully;
- a final independent-verification failure can trigger repair;
- the repair budget prevents an unbounded retry loop;
- a failed task checkpoint can be resumed with additional repair budget.

## End-to-end repair smoke test

Command:

```bash
node src/cli.js run examples/repair-task.json \
  --workspace /tmp/forgepilot-v020-smoke \
  --apply \
  --max-repairs 2
```

Result: **PASS**.

Observed sequence:

1. ForgePilot wrote an intentionally broken Node program.
2. The initial runtime action exited with code 1 and was recorded as **failed**.
3. A `replace_text` repair replaced only the defective program body.
4. ForgePilot reran the exact failed runtime action; it passed.
5. The independent verifier launched the repaired program again and required `DEMO FIXED` in stdout.
6. Final verification passed.

The generated report correctly retained all three action events:

```text
write_file: passed
run_command (main): failed
run_command (retry #1): passed
```

This demonstrates that v0.2 does not erase the original failure when a repair succeeds.
