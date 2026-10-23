# ForgePilot v0.7 Validation

## Automated suite

Run:

```text
npm test
```

Release acceptance requires **51/51 tests**: all legacy v0.1–v0.6 coverage plus 8 v0.7 multi-agent tests.

v0.7 adds coverage for:

- read-only role-policy enforcement;
- Planner → Implementer structured handoffs;
- Reviewer request-changes → Implementer revision → Reviewer approval;
- malicious Reviewer mutation payload rejection without execution;
- Verifier rejection → Debugger repair → independent re-audit;
- review-round budget enforcement independent of repair budget;
- Ollama structured role prompts for Planner, Implementer, Reviewer, and Verifier;
- preservation of the existing 43 v0.1–v0.6 tests.

## Multi-agent CLI acceptance

Run:

```powershell
mkdir work\multi-agent-demo
node src/cli.js run examples/multi-agent-task.json `
  --workspace .\work\multi-agent-demo `
  --agents `
  --apply
```

Acceptance requires:

1. Planner and Implementer handoffs are recorded;
2. initial `release-note.txt` contains `DRAFT`;
3. Reviewer round 1 requests changes;
4. Reviewer never executes a mutation itself;
5. Implementer revision replaces `DRAFT` with `VERIFIED`;
6. Reviewer round 2 approves;
7. deterministic file-content checks pass;
8. Verifier approves the evidence;
9. final result is PASS;
10. Markdown/JSON reports include handoffs, reviews, verifier audit, and zero policy violations.

## Read-only attack acceptance

The automated suite supplies a Reviewer verdict containing a hidden `write_file` action. Acceptance requires ForgePilot to:

- reject the verdict as a role-policy violation;
- not create the requested malicious file;
- fail the task closed.

## Legacy acceptance

The v0.6 visual failure→repair demo and direct `compare-images` PASS/FAIL checks remain part of regression acceptance. Sandboxed execution-provider tests remain required even when Docker/Podman is unavailable on the build host.

## Archive acceptance

Before release:

1. syntax-check every `.js` file;
2. run the complete test suite in the working tree;
3. run the multi-agent CLI reviewer→revision→verifier acceptance;
4. verify CLI version prints `0.7.0`;
5. verify report output includes the Multi-Agent Engineering section;
6. create the ZIP;
7. extract the exact ZIP to a clean directory;
8. rerun the complete test suite from the extracted archive;
9. rerun the multi-agent CLI acceptance from the extracted archive;
10. verify no transient `.forgepilot/`, `work/`, or `node_modules/` state is included in the release archive.
