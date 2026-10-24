# ForgePilot v0.12 Validation

Release acceptance requires all earlier v0.1-v0.11 regression tests plus v0.12 project/recipe/queue checks.

## Automated suite

The v0.12 suite covers:

- all 89 prior guarded execution, repair, repository, test-first, sandbox, visual, multi-agent, computer-control, hardening, one-click, and control-center behaviors;
- saved project registry persistence and path validation;
- immutable built-in recipes plus persisted custom recipes;
- recipe goal expansion and inherited safe defaults;
- FIFO concurrency enforcement;
- queued pause/resume/cancel and global queue pause/resume;
- auditable retry links;
- queue persistence across dashboard restarts;
- stale `running` state becoming `interrupted`;
- token-protected project/recipe/queue mutation APIs.

## Release acceptance

A release candidate must also pass:

1. `npm test` (99 tests).
2. syntax check every JavaScript file with `node --check`.
3. `node src/cli.js --version` returns `0.12.0`.
4. dashboard HTTP acceptance creates a saved project and uses a built-in recipe.
5. two real ForgePilot subprocess jobs demonstrate one-running/one-queued FIFO behavior.
6. both jobs finish PASS with signed JSON provenance.
7. queue retry creates a new job with an auditable `retryOf` link.
8. final ZIP extraction reruns the automated suite and acceptance path.

## Platform limitation

The release build host is Linux. Windows one-click scripts remain statically/syntax validated here, while the real Desktop shortcut, `winget` bootstrap, portable Windows Node fallback, and native Windows UI Automation require Windows 10/11 acceptance on the target PC.
