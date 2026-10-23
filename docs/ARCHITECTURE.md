# ForgePilot v0.7 Architecture

```text
Task / Goal
    |
    v
Repository Intelligence
    |
    v
Planner [read-only]
    |
    v
Implementer [mutation proposals]
    |
    v
Test-first Controller (optional)
    |
    v
Execution Provider
   / \
Host  Disposable Sandbox
       |-- Docker / Podman
       |-- network policy
       |-- CPU / RAM / PID limits
       v
Guarded Executor / Test Gates
    |
    v
Reviewer [read-only]
   / \
approve  request changes
  |            |
  |            v
  |      Implementer revision
  |            |
  +------------+
    |
    v
Visual + Deterministic Verification
    |
    v
Verifier [read-only]
   / \
approve  reject
  |       |
  |       v
  |    Debugger [mutation proposals]
  |       |
  +-------+--> bounded re-verification
    |
    v
PASS / sandbox promotion / evidence report
```

## Trust boundaries

### Planner
Read-only. Produces strategy, risks, and acceptance criteria. It cannot execute code or return mutation actions in multi-agent mode.

### Implementer
May propose structured mutations. It never writes files directly; all actions pass through the guarded executor and existing workspace/sandbox policies.

### Debugger
Receives concrete failure evidence and may propose the smallest repair. Repair count remains bounded by `maxRepairs`.

### Reviewer
Read-only. It may approve or request changes with structured findings. Any attempt to return actions/commands/patches is a policy violation and fails closed. Reviewer change requests are routed back to the Implementer with a separate bounded review-round budget.

### Verifier
Read-only. It receives a bounded summary of deterministic checks and Git-diff evidence. It cannot make a failed deterministic gate pass. When configured as a required gate, rejection becomes a failed `agent_verifier` check that can enter the Debugger loop.

### Orchestrator
Owns sequencing, budgets, protected test/baseline hashes, role-policy enforcement, evidence persistence, and PASS/FAIL. Agents do not directly call one another.

### Execution provider
All repository code execution goes through one provider. Sandbox mode keeps repository code inside the disposable copy until PASS-only promotion.

### Test-first controller
Owns AUTHOR → RED → IMPLEMENT → GREEN sequencing and protects RED-proven tests from later modification.

### Visual controller
Fingerprints configured PNG baselines before implementation and performs deterministic dimensions/pixel/region checks plus optional local vision assertions.

## Structured handoffs

Persistent handoff records contain summaries rather than source excerpts:

```json
{
  "from": "reviewer",
  "to": "implementer",
  "kind": "review_verdict",
  "summary": {
    "round": 1,
    "verdict": "request_changes",
    "findings": [
      { "severity": "error", "path": "src/app.js", "message": "..." }
    ]
  }
}
```

This keeps the audit trail useful without turning reports into copies of private source code.
