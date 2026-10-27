# ForgePilot v0.17 Validation

Release acceptance requires the complete historical suite plus Universal Prompt routing and the v0.16 watchdog/low-resource guarantees.

## Automated coverage

The v0.17 additions verify:

- natural-language intent/capability inference;
- existing-workspace extraction from a path embedded in prose;
- automatic project allocation when no path is supplied;
- all-sensitive-categories fail-closed task policy with only inferred grants;
- one visible prompt UI and token-protected `/api/prompt`;
- retries staying in the original workspace;
- fast child-process output/exit listeners attached before asynchronous watchdog configuration;
- all prior v0.1-v0.16 guarded execution, repair, repository, test-first, sandbox, visual, multi-agent, computer-control, hardening, one-click, queue, rollback, health, confidence, patch review, Just Build It, and watchdog tests.

## Release acceptance

1. `npm test` passes the complete suite (**140 tests**).
2. Every JavaScript file passes `node --check`.
3. `node src/cli.js --version` returns `0.18.0`.
4. A token-protected dashboard Universal Prompt request with no repository creates and completes a project through an Ollama-compatible endpoint.
5. A Universal Prompt containing an existing repository path uses that repository rather than allocating another project.
6. The same acceptance works from the extracted final ZIP.
7. Archive contains no `.forgepilot` runtime state, `node_modules`, or temporary work directories.
8. Windows `.cmd` and PowerShell one-click entry points retain CRLF line endings.

## Platform limitation

The release build host is Linux. Windows one-click scripts are statically/syntax validated here; Desktop shortcut creation, `winget` bootstrap, portable Windows Node fallback, and native Windows UI Automation still require Windows 10/11 acceptance on the target PC.
