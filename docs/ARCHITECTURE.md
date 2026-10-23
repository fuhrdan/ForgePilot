# ForgePilot v0.6 Architecture

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
Host  Disposable Sandbox
       |-- Docker / Podman
       |-- network policy
       |-- CPU / RAM / PID limits
       v
Guarded Executor / Test Gates / Repair Retries
    |
    v
Visual Verification (optional)
    |-- command-driven PNG capture
    |-- evidence copy
    |-- frozen-baseline pixel diff
    |-- deterministic pixel/region assertions
    |-- optional local vision provider
    v
Independent Verifier
    |
    v
PASS? ---- no ----> structured failure evidence → bounded repair
  |
 yes
  v
Promote manifest delta (sandbox mode)
  |
  v
Evidence Report + artifact / screenshot copy-out
```

## Trust boundaries

### Planner
May propose structured edits and checks. It cannot execute code or declare success.

### Workspace controller
In sandbox mode it copies the repository to a temporary workspace before execution. The host repository remains unchanged until PASS.

### Execution provider
All repository code execution goes through one provider. Visual capture commands use the same provider, preventing a sandboxed build from being followed by accidental host-side screenshot execution.

### Test-first controller
Owns AUTHOR → RED → IMPLEMENT → GREEN sequencing and protects RED-proven tests from later modification.

### Visual controller
Fingerprints configured baseline PNGs before implementation. Baseline paths join the protected-evidence set and cannot be changed by implementation/repair actions. Captured screenshots are copied to ForgePilot-owned evidence paths before evaluation.

### Deterministic visual verifier
Decodes PNG pixels itself and computes reproducible metrics. It does not depend on the planner's description of the UI.

### Vision provider
Optional and independent from the planner. It receives the captured screenshot plus explicit visible criteria and must return a structured verdict. Provider failure or insufficient confidence fails the assertion.

### Verifier
Reruns executable checks from actual state and combines code/test evidence with visual evidence. Git/file-policy inspection remains controlled by ForgePilot.

### Promotion controller
After PASS, compares pre-run and post-run manifests and copies only added/modified/deleted workspace files to the original workspace. `.forgepilot/` and `node_modules/` remain excluded. Visual evidence is exported separately.

## Visual failure repair

Visual checks are appended to normal verification. If they fail, the same bounded repair loop receives the failing check payload, including deterministic diff metrics or vision-model observations. After a source repair, ForgePilot recaptures the screenshot and independently reruns the visual assertions.

## Why v0.6 is not full computer use

v0.6 can execute a trusted screenshot-generation command (including installed Chromium/Chrome) and verify the resulting image. It does not yet own persistent GUI processes, mouse coordinates, keyboard input, accessibility trees, or recorded interaction traces. Those capabilities remain separate so visual verification can be trustworthy before broader computer control is introduced.
