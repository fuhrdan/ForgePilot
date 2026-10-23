# ForgePilot v0.7 Multi-Agent Engineering

ForgePilot v0.7 separates software-engineering responsibilities into five roles. The roles exchange structured evidence through the orchestrator rather than chatting freely or sharing execution authority.

## Roles and permissions

| Role | Purpose | May propose mutations? | May execute? |
| --- | --- | --- | --- |
| Planner | Strategy, risks, acceptance criteria | No | No |
| Implementer | Initial implementation and review revisions | Yes | No |
| Debugger | Evidence-driven repairs after failures | Yes | No |
| Reviewer | Read-only code/change review | No | No |
| Verifier | Read-only audit of deterministic evidence | No | No |

Only ForgePilot's guarded executor runs actions. Even mutation-capable roles merely return structured `write_file`, `replace_text`, or allowlisted `run_command` actions.

## Handoff flow

```text
Goal / Repository
      |
      v
 Planner (read-only)
      |
      | strategy + acceptance criteria
      v
 Implementer
      |
      | structured actions
      v
 Guarded Executor
      |
      v
 Reviewer (read-only)
   /      \
approve   request_changes
  |             |
  |             v
  |        Implementer revision
  |             |
  |-------------+
  v
Deterministic verification
  |
  v
Verifier (read-only)
  |
  +-- approve --------------------> PASS
  |
  +-- request_changes --> Debugger --> reverify
```

Test-first, sandbox, Git-scope, and visual-verification gates remain owned by the ForgePilot orchestrator, not by any LLM role.

## Read-only role enforcement

Planner, Reviewer, and Verifier responses are inspected before use. A response fails closed if it contains mutation payloads such as:

- non-empty `actions`, `patches`, `writes`, `commands`, or `mutations` arrays;
- raw `command`, `patch`, `replacement`, `replace`, or `content` fields;
- action-shaped objects with `type` equal to `write_file`, `replace_text`, or `run_command`.

A Reviewer cannot make a patch “while reviewing.” It may only approve or request changes with findings. If changes are requested, the request is handed to the Implementer role.

## Bounded review rounds

Review churn has a separate budget from debugger repair attempts:

```json
{
  "agentTeam": {
    "enabled": true,
    "maxReviewRounds": 2,
    "requireVerifierApproval": true
  }
}
```

`maxReviewRounds` is the number of Implementer revision rounds allowed after Reviewer rejection. A rejection after the budget is exhausted fails the task instead of looping forever.

## Verifier gate

By default, a multi-agent task requires Verifier approval after deterministic checks pass. A Verifier rejection becomes a failed `agent_verifier` check and can enter the bounded Debugger repair loop.

For experiments where the model verifier should be advisory only:

```json
{
  "agentTeam": {
    "enabled": true,
    "requireVerifierApproval": false
  }
}
```

Deterministic test/build/Git/visual failures can never be turned into PASS by an approving model verifier.

## Role-specific local models

Ollama mode may use one model for every role or different models per role:

```json
{
  "planner": "ollama",
  "model": "qwen2.5-coder:7b",
  "agentTeam": {
    "enabled": true,
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

CLI overrides are also available:

```text
--model MODEL
--implementer-model MODEL
--debugger-model MODEL
--reviewer-model MODEL
--verifier-model MODEL
```

For Ollama tasks, the agent team is enabled by default in v0.7. Use `--no-agents` to run the legacy single-planner path. Scripted tasks remain single-agent unless `agentTeam.enabled` or `--agents` is supplied.

## Evidence and privacy

The final report records role names, handoff types, verdicts, findings, action counts, and model identifiers. Repository source excerpts used to reason remain transient and are not copied into the persistent handoff log.
