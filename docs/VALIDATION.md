# ForgePilot v0.16 Validation

Release acceptance requires all earlier v0.1-v0.15 regression tests plus v0.16 Just Build It and watchdog checks.

## Automated suite

The v0.16 suite covers all prior guarded execution, repair, repository, test-first, sandbox, visual, multi-agent, computer-control, hardening, one-click, queue, rollback, runtime-health, confidence, and patch-review behaviors plus:

- collision-safe automatic project creation;
- Simple Build Mode single-agent policy and bounded watchdog settings;
- Ollama request abort + smaller-model fallback after a stalled model;
- dashboard termination of a completely silent child process;
- visible model/progress phase updates;
- token-protected `/api/build` and default BUILD IT UI.

## Release acceptance

A release candidate must also pass:

1. `npm test` (133 tests).
2. syntax check every JavaScript file with `node --check`.
3. `node src/cli.js --version` returns `0.16.0`.
4. a real dashboard Simple Build request with no repository creates a project, calls an Ollama-compatible planner, executes code, independently verifies it, and emits signed provenance.
5. the same flow from the extracted final ZIP.
6. archive contains no `.forgepilot` runtime state, `node_modules`, or temporary work directories.
7. Windows `.cmd` and PowerShell one-click entry points retain CRLF line endings.

## Platform limitation

The release build host is Linux. Windows one-click scripts are statically/syntax validated here, while the real Desktop shortcut, `winget` bootstrap, portable Windows Node fallback, and native Windows UI Automation still require Windows 10/11 acceptance on the target PC.
