# ForgePilot v0.13 Validation

Release acceptance requires all earlier v0.1-v0.11 regression tests plus v0.12 project/recipe/queue checks plus v0.13 workspace-safety checks.

## Automated suite

The v0.12/v0.13 suite covers:

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

1. `npm test` (109 tests).
2. syntax check every JavaScript file with `node --check`.
3. `node src/cli.js --version` returns `0.13.0`.
4. dashboard HTTP acceptance performs repository preflight and starts a real ForgePilot subprocess against a local Ollama-compatible endpoint.
5. the job finishes PASS with signed JSON provenance and an exact added/modified/deleted change set.
6. rollback dry-run reports the reversible operations without modifying the workspace.
7. rollback restores the exact pre-job state, including removal of files created by ForgePilot.
8. final ZIP extraction reruns the automated suite and the same signed checkpoint/rollback acceptance path.

## Platform limitation

The release build host is Linux. Windows one-click scripts remain statically/syntax validated here, while the real Desktop shortcut, `winget` bootstrap, portable Windows Node fallback, and native Windows UI Automation require Windows 10/11 acceptance on the target PC.

- v0.13 additionally validates reversible add/modify/delete checkpoints, preservation of pre-existing dirty state, post-run conflict detection, dry-run rollback, risk preflight, dashboard change summaries, and token-protected rollback.
