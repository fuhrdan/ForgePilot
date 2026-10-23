# Changelog

## 0.7.0 — Multi-Agent Engineering Team

### Added
- Separated Planner, Implementer, Debugger, Reviewer, and Verifier roles.
- `AgentTeam` coordinator with structured handoff audit trail.
- Read-only role-policy enforcement for Planner, Reviewer, and Verifier.
- Bounded Reviewer → Implementer change-request rounds.
- Independent Verifier gate that can feed evidence into the existing bounded Debugger loop.
- Role-specific Ollama model selection through `agentTeam.models` and CLI overrides.
- Multi-agent evidence in JSON/Markdown reports: role models, handoffs, review verdicts, verifier audits, and policy violations.
- `--agents`, `--no-agents`, and `--max-review-rounds` CLI controls.
- `--implementer-model`, `--debugger-model`, `--reviewer-model`, and `--verifier-model` CLI controls.
- `docs/MULTI_AGENT.md` and a deterministic multi-agent reviewer/revision demo.

### Changed
- Ollama tasks use multi-agent mode by default; scripted tasks remain opt-in for backward compatibility.
- Planner in multi-agent mode returns read-only strategy before a separate Implementer produces mutations.
- Debugging uses the dedicated Debugger role while preserving the v0.2 bounded repair budget.
- Final deterministic/visual verification is followed by a read-only Verifier audit when multi-agent mode is enabled.
- Checkpoint schema version advanced to 6 to retain multi-agent evidence.

### Safety
- Reviewer/Verifier mutation payloads fail closed and are never executed.
- Deterministic test/build/Git/visual failures cannot be overridden by an approving model Verifier.
- Handoff logs store bounded summaries, not repository source excerpts.
- Existing protected RED tests, visual baselines, executable allowlists, sandbox limits, and PASS-only promotion remain enforced.
