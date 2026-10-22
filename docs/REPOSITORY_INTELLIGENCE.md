# Repository Intelligence

ForgePilot v0.3 introduces a read-only repository analysis stage before planning and again before repair attempts.

## Scanner

Git workspaces use:

```text
git ls-files -co --exclude-standard -z
```

This returns tracked files plus non-ignored untracked files. Generated files ignored by the repository are not sent into the AI context and are not fingerprinted for change attribution.

Non-Git workspaces use a filesystem fallback with root `.gitignore` support and built-in generated-directory exclusions.

## Detection

Detection is intentionally deterministic and manifest-based. It does not ask an LLM what kind of repository it is.

Current signals include:

| Signal | Detection |
|---|---|
| `package.json` | Node.js |
| `.ts` / TypeScript dependency | TypeScript/JavaScript |
| common package dependencies | React, Next.js, Angular, Vue, Svelte, Express, Fastify, NestJS, Electron, Vite |
| `.sln` / `.csproj` | .NET / C# |
| `pom.xml` | Maven / Java |
| `build.gradle*` | Gradle / Java/Kotlin |
| `pyproject.toml`, requirements, `.py` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `project.godot` | Godot |
| `.c/.h` | C |
| `.cpp/.hpp/...` | C++ |

## Context selection

The task goal is tokenized into search terms. Candidate file paths gain relevance for matching goal terms and for belonging to likely source/manifests/docs locations.

Only text-like files under 1 MiB are candidates for source excerpts. Each excerpt is capped so one large README cannot consume the entire context window.

The configured token budget is approximate (`characters / 4`) because v0.3 deliberately has no tokenizer dependency.

## Build/test hints

Hints are deterministic recommendations, not automatic execution. Examples include package scripts, `dotnet build`, `pytest`, `go test ./...`, and `cargo test`.

v0.4 will promote this information into a test-first execution policy with discovered test gates.

## Git baseline and diff

ForgePilot hashes the current contents of tracked/non-ignored files at task start. At verification time it compares current hashes with those baseline hashes.

This allows a task to distinguish:

- changes made before ForgePilot started;
- changes introduced during the task;
- new files;
- deleted files.

`git_diff` can enforce an allowed list, while the ordinary report provides a non-blocking audit even without that check.

## Limits in v0.3

- The non-Git `.gitignore` parser covers common patterns but is not a complete reimplementation of every Git ignore edge case.
- Git fingerprint scope is capped at 10,000 files; blocking change-scope checks fail closed if the scan is truncated.
- Context selection is path/goal heuristic-based rather than semantic embeddings.
- Nested monorepo project-root modeling is basic and will be expanded in later releases.
