# Security Policy

## Supported version

The current ForgePilot release line is supported for security fixes. Older pre-1.0 releases may be superseded rather than patched individually.

## Reporting a vulnerability

Please do not publish credentials, private repository content, or working exploit details in a public issue.

Preferred path:

1. Use GitHub's **Security → Report a vulnerability** private reporting flow if it is enabled for this repository.
2. If private reporting is unavailable, open a minimal public issue stating that you have a security report and need a private contact channel. Do not include exploit details.

Useful information includes the ForgePilot version, operating system, affected feature, impact, reproduction conditions, and whether the issue requires local user approval.

## Scope

ForgePilot intentionally treats these as security boundaries:

- workspace/path confinement;
- explicit capability approvals;
- loopback-only dashboard controls;
- secret redaction;
- sandbox execution boundaries;
- immutable test/baseline protections;
- signed provenance;
- conflict-safe rollback;
- role restrictions for read-only agents.

Reports that bypass one of these controls are especially useful.
