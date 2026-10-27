# ForgePilot v0.19 Validation

Release acceptance requires the complete historical suite plus the v0.19 reliability/deliverable features and the existing Universal Prompt, watchdog, low-resource, rollback, and provenance guarantees.

## Automated coverage

The v0.19 additions verify:

- standards-shaped dependency-free ZIP generation;
- finished deliverable packaging and real build-artifact preference;
- privacy-safe diagnostic bundles without source, prompts, secrets, or repository filenames;
- actionable failure diagnosis for watchdogs, missing toolchains, permissions, and local-model memory pressure;
- local Ollama model benchmarking and recommendation;
- GitHub Release update detection;
- interrupted dashboard jobs resuming through the core ForgePilot state checkpoint;
- all prior guarded execution, repair, repository, test-first, sandbox, visual, multi-agent, computer-control, hardening, one-click, queue, rollback, health, confidence, patch review, Universal Prompt, and watchdog tests.

## Release acceptance

1. The complete suite passes (**154 tests**), validated in isolated test-file batches to avoid CI-host timing contention.
2. All **79** JavaScript/MJS source, test, and release-script files pass `node --check`.
3. `node src/cli.js --version` returns `0.19.0`.
4. `node scripts/release-check.mjs` passes.
5. A real scripted engineering task returns `PASS`, creates a signed report, and produces a finished deliverable with a runnable launcher when an entry point is identifiable.
6. `forgepilot repair` passes with Ollama treated as optional.
7. `forgepilot diagnostics` creates a readable ZIP containing only sanitized diagnostic metadata.
8. Both the repository ZIP and Windows release ZIP are extracted and revalidated.
9. Archives contain no `.forgepilot` runtime state, `node_modules`, build `dist`, or temporary work directories.
10. Windows `.cmd` and PowerShell entry points retain CRLF line endings.

## Platform limitation

The release build host is Linux. Windows PowerShell/update/install scripts are statically validated and packaged with CRLF line endings here; Desktop shortcut creation, `winget` bootstrap, portable Windows Node fallback, the trusted Windows updater, and native Windows UI Automation still require Windows 10/11 acceptance on the target PC.
