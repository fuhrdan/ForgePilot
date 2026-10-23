# ForgePilot v0.8 Validation

## Automated suite

Release acceptance requires **63/63 tests**. v0.8 adds 12 computer-control tests on top of the 51 v0.7 tests, covering:

- read-only agent rejection of computer actions;
- localhost/external-origin policy;
- current-target origin enforcement;
- secret typing redaction;
- screenshot path confinement;
- action routing through a persistent session;
- GUI failure → bounded repair → retry;
- selector-to-coordinate mouse dispatch;
- bounded accessibility capture;
- accessibility assertions as pass/fail gates;
- CDP navigation `errorText` fail-closed behavior;
- sandbox export of computer trace/screenshot evidence.

## Real Chromium acceptance

A release candidate must also connect to a real Chromium remote-debugging endpoint and successfully perform at minimum:

1. persistent CDP connection;
2. accessibility inspection;
3. accessibility assertion;
4. screenshot capture;
5. trace generation;
6. normal task report generation.

Mouse/keyboard/selector dispatch are additionally covered by deterministic CDP-client tests. If the build environment applies enterprise browsing policy, network navigation may be blocked by Chromium; ForgePilot must surface the browser `errorText` as a failure rather than report navigation PASS.

## Archive acceptance

1. syntax-check every `.js` file;
2. run all 63 tests in the working tree;
3. run the deterministic replay CLI demo;
4. run the real Chromium CDP acceptance when Chromium is available;
5. verify CLI version `0.8.0`;
6. verify report includes the Computer / IDE Control section;
7. create ZIP + SHA-256;
8. extract the exact ZIP into a clean directory;
9. rerun all 63 tests and replay demo from the extracted archive;
10. verify no transient `.forgepilot/`, `work/`, `node_modules/`, or smoke-test state is included.
