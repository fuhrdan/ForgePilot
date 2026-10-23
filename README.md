# ForgePilot v0.8.0

**A local-first verified software-engineering agent that can now operate a persistent browser/IDE session and leave a replayable evidence trail.**

ForgePilot combines repository intelligence, test-first engineering, bounded repair, Docker/Podman sandboxes, visual verification, separated Planner/Implementer/Debugger/Reviewer/Verifier roles, and in v0.8 a guarded **Computer / IDE Control** layer.

## Requirements

- Node.js 22+
- Git recommended
- Docker/Podman optional for `--sandbox`
- Ollama optional for local AI roles and multimodal visual checks
- Chromium/Chrome or another CDP-enabled Electron application optional for real computer control

There are no npm runtime dependencies.

## Quick start

```powershell
npm test
node src/cli.js doctor
node src/cli.js analyze . --goal "fix the settings UI"
```

Run the deterministic v0.8 demo:

```powershell
node src/cli.js run examples/computer-task.json `
  --workspace .\work\computer-demo `
  --apply
```

## v0.8 engineering flow

```text
Repository + Goal
      |
      v
Planner [read-only]
      |
      v
Implementer
      |
      +---- file / command actions ----> Guarded Executor
      |
      +---- computer actions ----------> Persistent GUI Session
                                           | accessibility tree
                                           | click / type / key
                                           | screenshot evidence
                                           | replayable trace
      |
      v
Reviewer [read-only]
      |
Tests / Build / Git / Visual / UI-state gates
      |
      v
Verifier [read-only]
      |
 PASS + evidence-backed report
```

Computer actions use the same bounded failure/repair machinery as normal implementation actions. A failed selector, UI-state assertion, or browser action can feed concrete evidence to the Debugger and be retried within `maxRepairs`.

## Computer / IDE actions

```json
{"type":"computer_navigate","url":"http://localhost:3000"}
{"type":"computer_inspect","maxNodes":200}
{"type":"computer_assert","role":"button","name":"Save"}
{"type":"computer_click","selector":"#save"}
{"type":"computer_type","selector":"#name","text":"value"}
{"type":"computer_key","key":"Enter"}
{"type":"computer_wait","ms":250}
{"type":"computer_screenshot","path":"final.png"}
```

Configure a real CDP session with:

```json
{
  "computer": {
    "enabled": true,
    "driver": "cdp",
    "endpoint": "http://127.0.0.1:9222",
    "targetHint": "My App",
    "allowedOrigins": ["http://localhost", "http://127.0.0.1"]
  }
}
```

CLI overrides include `--computer`, `--computer-driver`, `--computer-endpoint`, and `--computer-target`.

## Computer-control safety

- localhost-only navigation by default;
- explicit allowlist required for external origins;
- current-tab origin is validated before inspection/interaction;
- `data:` URLs require explicit opt-in;
- file URLs stay inside the workspace;
- typed text is redacted from traces unless `secret:false` is explicit;
- screenshot paths cannot escape the evidence directory;
- Planner/Reviewer/Verifier cannot return GUI actions;
- real GUI control and `--sandbox` are intentionally not combinable in v0.8 because a host IDE could bypass sandbox promotion.

Evidence is stored under:

```text
.forgepilot/computer/<task-id>/
    trace.json
    *.png
```

## Multi-agent separation

The v0.7 guarantees remain: Planner, Reviewer, and Verifier are read-only; Implementer and Debugger may only *propose* mutations; the orchestrator executes them through guarded providers. Reviewer revision rounds and Debugger repairs have separate budgets.

## Test-first + visual verification

The v0.4–v0.6 guarantees remain:

```text
AUTHOR → RED → IMPLEMENT → GREEN → REGRESSION → BUILD
```

RED must fail for the expected reason and RED-proven tests remain immutable. PNG baselines are frozen before implementation, deterministic pixel/region checks remain available, and optional local vision verdicts cannot override failed deterministic gates.

## Disposable sandbox

```powershell
node src/cli.js run task.json --sandbox --apply
```

Repository command execution uses a disposable copy with no network by default, CPU/RAM/PID limits, dropped capabilities, and PASS-only promotion. v0.8 intentionally fails closed if real computer control is requested at the same time.

## Reports

Reports live under `.forgepilot/runs/<timestamp>/` and include repository metadata, RED/GREEN/build evidence, visual evidence, Git attribution, repair attempts, agent handoffs/verdicts, and now the computer-session driver, action counts, trace path, and screenshot evidence directory.

See `docs/COMPUTER_CONTROL.md`, `docs/MULTI_AGENT.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`.
