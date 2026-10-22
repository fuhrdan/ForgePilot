# ForgePilot v0.5 Architecture

```text
Task / Goal
    |
    v
Repository Intelligence
    |
Planner
    |
Test-first Controller (optional)
    |
    v
Execution Provider
   / \
  /   \
Host  Disposable Sandbox
       |-- Docker / Podman
       |-- network policy
       |-- CPU / RAM / PID limits
       |-- command allowlist
       |-- no-new-privileges
       v
Guarded Executor / Test Gates / Repair Retries
    |
    v
Independent Verifier
    |
    v
PASS? ---- no ----> discard sandbox source changes
  |
 yes
  v
Promote manifest delta to original workspace
  |
  v
Evidence Report + optional artifact copy-out
```

## Trust boundaries

### Planner
May propose structured edits and checks. It cannot execute code or declare success.

### Workspace controller
In sandbox mode it copies the repository to a temporary workspace before execution. The host repository remains unchanged until PASS.

### Execution provider
All repository code execution goes through one provider. Host mode uses the existing shell-free allowlisted runner. Container mode translates the same command specification into a hardened Docker/Podman invocation.

### Test-first controller
Owns AUTHOR → RED → IMPLEMENT → GREEN sequencing and protects RED-proven tests from later modification.

### Verifier
Reruns executable checks from actual state. In sandbox mode verification commands use the same container provider, while Git/file-policy inspection remains controlled by ForgePilot on the disposable workspace.

### Promotion controller
After PASS, compares pre-run and post-run manifests and copies only added/modified/deleted workspace files to the original workspace. `.forgepilot/` and `node_modules/` are excluded.

## Why Git inspection stays outside the container

Git diffing, scope checks, repository scanning, and policy decisions are ForgePilot control-plane operations. They inspect the disposable tree but do not execute repository application code, so they remain outside the untrusted execution provider.

## Failure behavior

A failed containerized task may still export explicitly requested artifacts, but source changes are not promoted. This gives v0.5 rollback semantics without running destructive reset commands against the user's real repository.
