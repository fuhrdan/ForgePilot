# ForgePilot

[![CI](https://github.com/fuhrdan/ForgePilot/actions/workflows/ci.yml/badge.svg)](https://github.com/fuhrdan/ForgePilot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/fuhrdan/ForgePilot?display_name=tag&sort=semver)](https://github.com/fuhrdan/ForgePilot/releases)
[![Node 22+](https://img.shields.io/badge/Node.js-22%2B-43853d)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Describe what you want. ForgePilot builds, fixes, tests, or reviews it — then verifies the result.**

ForgePilot is a local-first software-engineering agent designed around one universal prompt. It can create a new project or work in an existing repository, adapts itself to lower-resource PCs, and keeps verification, rollback, provenance, and safety controls behind a simple interface.

## Quick start — Windows

1. Download **`ForgePilot-v0.18.0-windows.zip`** from the [latest GitHub Release](https://github.com/fuhrdan/ForgePilot/releases/latest).
2. Extract the ZIP.
3. Double-click **`INSTALL_FORGEPILOT.cmd`** once.
4. Use the **ForgePilot** desktop shortcut from then on.
5. Type what you want and press **DO IT**.

ForgePilot can bootstrap a private Node.js 22+ runtime if needed. Git and Ollama are optional/best-effort dependencies; the installer inspects the machine and chooses a conservative runtime profile automatically.

## One prompt

Examples:

```text
Build a C# desktop app that finds duplicate files and includes a Windows launcher.

Fix the login retry bug in C:\Projects\MyApp and add a regression test.

Review C:\Projects\OpsForge for reliability problems.

Run the tests in C:\Projects\AnchorWeight and fix any failures.
```

If the prompt includes an existing path, ForgePilot uses it. Otherwise it creates a project under the ForgePilot workspace automatically.

## Why ForgePilot

- **One universal prompt** — build, fix, test, review, package, or inspect from one entry point.
- **Low-resource aware** — RAM/CPU/GPU checks, conservative context sizes, one-agent default, model downgrade/fallback, and one active AI job at a time.
- **Hard watchdogs** — model, command, no-progress, and overall-job limits prevent indefinite stalls.
- **Verified results** — tests, command verification, optional test-first flow, visual checks, Git-scope checks, and evidence scoring.
- **Reversible changes** — pre-job checkpoints and conflict-safe rollback avoid blind `git reset --hard`.
- **Signed provenance** — completed reports are SHA-256 hashed and signed with a local Ed25519 key.
- **Local-first** — the dashboard binds to loopback; Ollama support is local by default.
- **Advanced controls remain available** — sandboxing, multi-agent review, computer control, secrets, and explicit approvals are still available without cluttering the normal UI.

## Resource behavior

ForgePilot rechecks available resources before queued AI jobs. It can automatically reduce model size, context, repair budget, and expensive features when the machine is under pressure.

Typical automatic coding-model tiers:

| Machine state | Default direction |
| --- | --- |
| Very constrained | 1.5B coding model, minimal context, one repair |
| Low resource | 3B coding model, bounded context |
| Balanced | 7B coding model |
| Higher-end | Larger models only when RAM/VRAM justify them |

ForgePilot never silently scales above the configured machine plan during a job.

## CLI

The desktop UI is the normal path, but the CLI remains available:

```powershell
forgepilot prompt "Build a tiny Node app that prints Hello ForgePilot"
forgepilot prompt "Fix C:\Projects\MyApp and add a test"
forgepilot health
forgepilot doctor
```

`forgepilot build` remains a backward-compatible alias for the universal prompt path.

## Development

Requirements:

- Node.js 22+
- Git recommended
- Ollama optional for local AI work

```bash
git clone https://github.com/fuhrdan/ForgePilot.git
cd ForgePilot
npm test
npm run check
node src/cli.js --version
```

The project intentionally has no required npm runtime dependencies.

## Repository layout

```text
.github/      CI, release automation, issue/PR templates
docs/         architecture, safety, installation, release documentation
examples/     deterministic and AI workflow examples
scripts/      one-click Windows install/run and release tooling
src/          ForgePilot implementation
test/         Node test suite
```

## Releases

A tag named `vX.Y.Z` runs the GitHub release workflow. It validates the repository, runs the full test suite, builds the Windows one-click release ZIP and SHA-256 file, then publishes them to GitHub Releases.

See [Release process](docs/RELEASING.md) and [v0.18.0 release notes](docs/releases/v0.18.0.md).

## Documentation

Start with:

- [Installation](docs/INSTALLATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Repository intelligence](docs/REPOSITORY_INTELLIGENCE.md)
- [Workspace safety and rollback](docs/WORKSPACE_SAFETY.md)
- [Sandboxing](docs/SANDBOX.md)
- [Computer control](docs/COMPUTER_CONTROL.md)
- [Validation](docs/VALIDATION.md)
- [Roadmap](docs/ROADMAP.md)

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

For security-sensitive reports, follow [SECURITY.md](SECURITY.md) and avoid publishing exploit details in a public issue.

## License

ForgePilot is released under the [MIT License](LICENSE).
