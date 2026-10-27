# Contributing to ForgePilot

Thanks for helping improve ForgePilot.

## Before opening a pull request

- Keep the default user experience centered on one universal prompt.
- Preserve one-click Windows install/run.
- Preserve adaptive low-resource behavior and bounded watchdogs.
- Avoid adding required npm runtime dependencies unless there is a compelling reason.
- Do not weaken approval, rollback, provenance, sandbox, or path-confinement checks.

## Development setup

```bash
git clone https://github.com/fuhrdan/ForgePilot.git
cd ForgePilot
npm test
npm run check
```

Node.js 22+ is required. Ollama is optional for most unit tests.

## Pull requests

1. Create a focused branch.
2. Add or update tests for behavior changes.
3. Run `npm test`.
4. Run `npm run check`.
5. Update documentation or the changelog when user-facing behavior changes.
6. Explain the verification performed in the pull request description.

Keep pull requests narrow enough to review. Security-sensitive fixes should follow `SECURITY.md` rather than beginning as a public exploit report.
