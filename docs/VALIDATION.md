# ForgePilot v0.9 Validation

Release acceptance requires all earlier v0.1-v0.8 regression tests plus v0.9 product-hardening checks.

## Automated suite

The v0.9 suite covers:

- all guarded execution / repair / repository / test-first / sandbox / visual / multi-agent / computer-control behavior from prior releases;
- environment-backed secret resolution and persisted-output redaction;
- approval-gate deny/grant behavior and non-consumption of repair budget for policy failures;
- Ed25519 provenance signing, trusted-key verification, and tamper detection;
- recovery journal lifecycle and stale-process detection;
- hardware/profile selection;
- loopback dashboard signed-run history;
- native Windows UI driver platform refusal and fixed-bridge payload transport.

## CLI acceptance

A release candidate must also pass:

1. `npm test`.
2. syntax check every JavaScript file with `node --check`.
3. `node src/cli.js --version` returns `0.11.0`.
4. `examples/hardened-task.json` fails without required approvals and uses zero repair attempts.
5. the same task passes with `--approve file_write,command_exec`.
6. `verify-run` validates both signature/hash and the workspace trusted public key.
7. a secret-bearing task leaves no resolved secret value anywhere under `.forgepilot`.
8. final ZIP extraction reruns items 1-6 from the archive itself.

## Platform limitation

The release build host is Linux. The Windows UI driver is contract-tested with an injected bridge runner and fails closed off Windows, but real `.NET UIAutomationClient` execution and the PowerShell installer require a Windows acceptance pass on a Windows 10/11 machine. CDP/replay control remains independently covered by the v0.8 tests.
