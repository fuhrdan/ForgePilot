# ForgePilot v0.7.0

**A local-first software-engineering agent that separates planning, implementation, debugging, review, and verification—and proves the result with executable evidence.**

ForgePilot combines repository intelligence, test-first engineering, bounded repair, independent verification, disposable Docker/Podman execution, visual application verification, and in v0.7 a **five-role engineering team** with enforced separation of duties.

## Requirements

- Node.js 22+
- Git recommended
- Docker or Podman optional for `--sandbox`
- Ollama optional for local-AI roles
- A multimodal Ollama model optional for visual `vision` assertions
- Chromium/Chrome optional for command-driven web screenshots

ForgePilot has no npm runtime dependencies.

## Quick start

```powershell
npm test
node src/cli.js doctor
node src/cli.js analyze . --goal "improve multi-agent verification"
```

Run the deterministic multi-agent demo:

```powershell
node src/cli.js run examples/multi-agent-task.json `
  --workspace .\work\multi-agent-demo `
  --agents `
  --apply
```

The Reviewer deliberately rejects the first result. The separate Implementer performs the requested revision, Reviewer approves the second pass, and the Verifier audits the deterministic evidence.

## v0.7 engineering flow

```text
Repository + Goal
      |
      v
Planner [READ ONLY]
      |
      v
Implementer [proposes mutations]
      |
      v
Guarded Executor
      |
      v
Reviewer [READ ONLY]
    /    \
approve  request changes
   |          |
   |          v
   |      Implementer revision
   |          |
   +----------+
      |
      v
Tests / Build / Git / Visual Verification
      |
      v
Verifier [READ ONLY]
    /    \
approve  reject
   |       |
   |       v
   |    Debugger [repair proposal]
   |       |
   +-------+ → bounded re-verification
      |
      v
PASS + evidence report
```

Agents never execute repository code directly. They return structured decisions or mutation proposals; ForgePilot's orchestrator applies policy and the guarded execution provider remains the only execution path.

## Separation of duties

| Role | Responsibility | Mutation authority |
| --- | --- | --- |
| Planner | Strategy, risks, acceptance criteria | None |
| Implementer | Initial implementation and review revisions | May propose guarded actions |
| Debugger | Failure-driven repair | May propose guarded actions |
| Reviewer | Review changed state and request corrections | None |
| Verifier | Audit deterministic evidence | None |

Reviewer and Verifier responses are scanned for mutation payloads. A read-only role attempting to return `actions`, commands, patches, replacement content, or an action-shaped object fails closed.

## Enable/disable the team

Ollama tasks use the agent team by default in v0.7:

```powershell
node src/cli.js run task.json --planner ollama --model qwen2.5-coder:7b --apply
```

Disable it when comparing against the legacy single-planner path:

```text
--no-agents
```

Scripted tasks remain opt-in:

```text
--agents
```

or:

```json
{
  "agentTeam": {
    "enabled": true,
    "maxReviewRounds": 2,
    "requireVerifierApproval": true
  }
}
```

## Different local models for different roles

You can run all roles on one model or specialize them:

```json
{
  "planner": "ollama",
  "model": "qwen2.5-coder:7b",
  "agentTeam": {
    "models": {
      "planner": "qwen2.5-coder:7b",
      "implementer": "qwen2.5-coder:14b",
      "debugger": "qwen2.5-coder:14b",
      "reviewer": "qwen2.5-coder:7b",
      "verifier": "qwen2.5-coder:7b"
    }
  }
}
```

CLI overrides:

```text
--implementer-model MODEL
--debugger-model MODEL
--reviewer-model MODEL
--verifier-model MODEL
```

## Bounded disagreement

Reviewer change requests do not loop forever. `maxReviewRounds` limits Implementer revision rounds independently from the Debugger's `maxRepairs` budget.

A required Verifier rejection becomes a failed `agent_verifier` check. It can trigger a bounded Debugger repair, after which deterministic verification and a fresh Verifier audit run again.

Set:

```json
{ "agentTeam": { "requireVerifierApproval": false } }
```

if you want the model verifier to be advisory while deterministic gates remain authoritative.

## Test-first engineering

The v0.4 guarantees remain intact:

```text
AUTHOR → RED → IMPLEMENT → GREEN → REGRESSION → BUILD
```

RED must fail for the expected reason. RED-proven tests are hashed and protected from Implementer/Debugger modification.

## Disposable sandbox

Use:

```powershell
node src/cli.js run task.json --sandbox --apply
```

Repository execution occurs against a disposable copy through Docker/Podman. Defaults remain:

```text
network       none
CPUs          2
memory        2g
PID limit     256
capabilities  ALL dropped
privileges    no-new-privileges
image pull    never
```

Only PASS results are promoted to the original workspace.

## Visual verification

A task may capture PNG evidence and require:

- dimensions
- pixel diffs against frozen baselines
- pixel probes
- region averages
- optional local multimodal vision verdicts

Direct comparison remains available:

```powershell
node src/cli.js compare-images actual.png baseline.png `
  --channel-threshold 2 `
  --max-changed-ratio 0.005
```

## Evidence reports

Reports live under:

```text
.forgepilot/runs/<timestamp>/
    report.json
    report.md
```

v0.7 reports include:

- detected projects and selected repository context metadata;
- test-first RED/GREEN/build evidence;
- visual evidence metadata;
- Git diff and unexpected-file classification;
- repair attempts;
- Planner → Implementer → Reviewer → Verifier handoffs;
- review findings and revision rounds;
- verifier audits;
- role-policy violations;
- role model identifiers.

Source excerpts used by local models remain transient rather than being copied into the report.

## Safety model

- No shell-string execution.
- Executables remain allowlisted.
- Writes are constrained to the selected workspace.
- Network is disabled by default in sandbox mode.
- Checked-in visual baselines and RED-proven tests are protected.
- Reviewer and Verifier are read-only by policy.
- Review and repair loops are bounded independently.
- Agents cannot directly commit or push.
- PASS is still controlled by ForgePilot's deterministic state/evidence, not by an agent saying “done.”

See `docs/MULTI_AGENT.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md` for the full design.
