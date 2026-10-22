# ForgePilot v0.5 Validation

## Automated suite

Run:

```text
npm test
```

Expected release result:

```text
tests 33
pass 33
fail 0
```

The suite contains all v0.1–v0.4 tests plus v0.5 coverage for:

- hardened Docker/Podman invocation construction;
- preservation of the normal executable allowlist;
- rejection of sandbox cwd escape;
- original workspace remaining unchanged before promotion;
- add/modify/delete manifest promotion;
- exclusion of `node_modules` / internal runtime state from promotion;
- artifact copy-out without source promotion;
- action and verification command routing through the execution provider.

## Host end-to-end acceptance

The included test-first fixture is copied into a temporary Git repository and run through the actual CLI. Acceptance requires valid RED evidence, implementation, GREEN/regression/build gates, independent verification, and PASS.

## Sandbox-runtime acceptance in this build environment

The release build environment does not expose Docker or Podman. Consequently:

1. container invocation is validated using an injected runner that captures the exact runtime command;
2. the CLI `doctor` path must report the runtime as unavailable;
3. requesting `--sandbox --apply` must fail before repository execution;
4. the source workspace must remain unchanged by that failed attempt.

This is deliberately recorded as a limitation rather than claiming an actual container was launched here. A CLI-level simulated-runtime acceptance test also exercises disposable-copy creation, provider routing, PASS-only promotion, artifact export, report metadata, and cleanup using a fake Docker executable that executes the requested command locally; this validates orchestration wiring but is not counted as real container isolation.

On a Docker/Podman machine, pre-pull the configured image and run:

```powershell
node src/cli.js run examples/sandbox-task.json `
  --workspace .\work\sandbox-demo `
  --sandbox `
  --apply
```

Expected behavior:

- commands execute in the selected container image;
- network is disabled by default;
- the original workspace remains unchanged until verification passes;
- PASS promotes `app.js` and `evidence.txt`;
- the requested artifact is copied beneath `.forgepilot/artifacts/<task-id>/`;
- FAIL does not promote source changes.

## Archive acceptance

Before release:

1. syntax-check every `.js` file;
2. run all 33 tests in the working tree;
3. run CLI version/doctor smoke checks;
4. run host end-to-end test-first acceptance;
5. create the ZIP;
6. extract the exact ZIP to a clean directory;
7. rerun all 33 tests from the extracted archive;
8. verify `forgepilot --version` prints `0.5.0`;
9. verify no transient `.forgepilot/` state is included in the archive.
