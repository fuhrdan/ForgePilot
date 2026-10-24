# ForgePilot v0.15 Validation

Release acceptance requires all earlier v0.1-v0.14 regression tests plus v0.15 evidence-confidence and privacy-preserving patch-review checks.

## Automated suite

The v0.15 suite covers:

- all 117 prior guarded execution, repair, repository, test-first, sandbox, visual, multi-agent, computer-control, hardening, one-click, control-center, workspace-safety, and adaptive-runtime behaviors;
- deterministic high/medium/low evidence confidence without presenting the score as a correctness probability;
- explicit evidence strengths, deductions, and gaps;
- conservative dashboard confidence adjustment for signed provenance, preflight risk, checkpoints, sensitive paths, and change-set size;
- privacy-preserving patch review metadata with no source content persisted;
- text/binary and oversized-file behavior;
- deterministic sensitive-path classification;
- dashboard finalization ordering so confidence/patch review are not published before signed provenance and checkpoint finalization complete.

## Release acceptance

A release candidate must also pass:

1. `npm test` (125 tests).
2. syntax check every JavaScript file with `node --check`.
3. `node src/cli.js --version` returns `0.15.0`.
4. a real ForgePilot task produces a signed `report.json` containing a deterministic `confidence` section.
5. `forgepilot assess <report.json>` displays the signed report's confidence, strengths, deductions, gaps, and provenance status.
6. dashboard finalization produces an exact change set, patch-review metadata, and a conservative dashboard confidence value.
7. patch-review state contains no source contents, including for sensitive/private repositories.
8. final ZIP extraction reruns the automated suite and the same signed confidence/checkpoint acceptance path.

## Platform limitation

The release build host is Linux. Windows one-click scripts remain statically/syntax validated here, while the real Desktop shortcut, `winget` bootstrap, portable Windows Node fallback, and native Windows UI Automation require Windows 10/11 acceptance on the target PC.
