# ForgePilot v0.5 Sandbox Contract

v0.5 introduces an execution-provider boundary so repository code can run either on the host or inside a disposable Docker/Podman container.

## Safety model

A sandboxed APPLY run creates a disposable copy of the selected workspace. ForgePilot edits that copy and mounts only that copy into the container. The original workspace is not modified while the task is running.

Container defaults:

- network: `none`
- CPUs: `2`
- memory: `2g`
- PID limit: `256`
- Linux capabilities: all dropped
- `no-new-privileges`
- `/tmp` is a bounded tmpfs
- image pull policy: `never`
- command executable must still pass ForgePilot's allowlist

The container receives `/workspace` as its working tree. Build/test commands, RED/GREEN gates, verification commands, and repair retries all use the same execution provider.

## Promotion / rollback

On PASS, ForgePilot computes a file manifest of the disposable workspace and promotes only added, modified, and deleted files back to the original workspace. `.forgepilot/` and `node_modules/` are not promoted.

On FAIL, no source changes are promoted. The original workspace therefore acts as the rollback target without needing destructive restore operations.

`--sandbox-keep` preserves the temporary workspace after a failed run for debugging. Otherwise it is deleted.

## Artifact copy-out

A task may request exact artifact paths:

```json
{
  "sandbox": {
    "enabled": true,
    "artifacts": ["dist/app.zip", "coverage/lcov.info"]
  }
}
```

Artifacts are copied to:

```text
.forgepilot/artifacts/<task-id>/...
```

Artifact export is independent of source promotion, so evidence/build outputs may be recovered from a failed sandbox without applying its source edits.

## CLI

```powershell
node src/cli.js run task.json `
  --workspace .\repo `
  --sandbox `
  --sandbox-runtime auto `
  --sandbox-image node:22-bookworm `
  --apply
```

Runtime selection checks Docker first, then Podman when `auto` is used.

The default pull policy is `never`; pre-pull the image yourself. This prevents ForgePilot from silently downloading and executing a new image.

## Task configuration

```json
{
  "sandbox": {
    "enabled": true,
    "runtime": "auto",
    "image": "node:22-bookworm",
    "network": "none",
    "cpus": "2",
    "memory": "2g",
    "pidsLimit": 256,
    "pullPolicy": "never",
    "artifacts": ["dist/app.zip"]
  }
}
```

Network can be changed explicitly by the task author, but `none` is the safe default.

## Current limitations

- Container images must already exist locally when `pullPolicy` is `never`.
- v0.5 does not automatically choose an ecosystem-specific image. Select one appropriate to the repository.
- Host-mode `--resume` remains supported. Sandbox resume is intentionally deferred because a v0.5 sandbox is a fresh disposable workspace.
- v0.5 limits CPU, memory, PIDs, network, and `/tmp`; a portable cross-runtime disk quota is not yet enforced. The disposable workspace itself is cleaned after the run unless preserved for debugging.
