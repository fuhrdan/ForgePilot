# One-Click Windows Setup — v0.10.0

## Normal user flow

1. Extract the ForgePilot release ZIP.
2. Double-click `INSTALL_FORGEPILOT.cmd`.
3. After installation, double-click the **ForgePilot** Desktop shortcut.
4. The launcher opens the local dashboard and uses the machine plan selected during installation.

## What the installer does

- Finds Node.js 22+; attempts `winget install OpenJS.NodeJS.LTS` when missing/too old, then falls back to a portable nodejs.org Windows ZIP under ForgePilot\runtime if necessary.
- Finds Git; attempts `winget install Git.Git` when missing.
- Copies ForgePilot to `%LOCALAPPDATA%\ForgePilot`.
- Adds that folder to the current user's PATH and creates `forgepilot.cmd`.
- Runs `forgepilot setup` to inspect RAM, currently available RAM, CPU count/model, GPU/VRAM (Windows CIM), free disk, and installed developer tools.
- Creates `%LOCALAPPDATA%\ForgePilot\config\machine-profile.json` and `launcher-env.cmd`.
- Creates `Documents\ForgePilot Workspace`.
- Optionally installs Ollama through `winget` and pulls the conservative bootstrap model when free disk is sufficient.
- Re-inspects the system after optional installs.
- Creates a Desktop `ForgePilot.lnk` shortcut.

## Low-resource behavior

ForgePilot selects a machine tier rather than assuming every computer can run the same local model.

| Tier | Typical trigger | Coding model | Context | Agents | Vision | Ollama parallelism |
|---|---|---|---:|---|---|---:|
| minimal | <10 GiB RAM or <=2 CPUs | qwen2.5-coder:1.5b | 1536 | off | off | 1 |
| low-resource | <20 GiB RAM or <6 CPUs | qwen2.5-coder:3b | 2304 | off | off | 1 |
| balanced | 20–47 GiB RAM | qwen2.5-coder:7b by default | 4096–6000 | on | conditional | 1 |
| high-quality | >=48 GiB RAM | 14B/32B depending on RAM/VRAM | 12000 | on | on | 1–2 |

The installer caps the first automatic model download at 7B. The recommended runtime model can be larger, but that upgrade is not silently downloaded during first install.

## One-click launcher behavior

`RUN_FORGEPILOT.cmd` calls `scripts/run-one-click.ps1` which:

- loads the saved machine configuration;
- applies `OLLAMA_NUM_PARALLEL`, `OLLAMA_MAX_LOADED_MODELS`, and `OLLAMA_KEEP_ALIVE` to the launcher process only;
- starts Ollama if it is installed but not responding locally;
- starts `forgepilot launch` on an OS-selected free loopback port;
- opens the local dashboard in the default browser.

Close the launcher console to stop the dashboard.

## Overrides

Power users can still override automatic defaults per task/run:

```powershell
forgepilot run task.json --profile balanced --model qwen2.5-coder:7b --apply
```

Task and CLI values take precedence over saved machine defaults.

## Installation caveats

The build/release environment is Linux, so the Node-side setup/profile/launcher logic is directly tested, but `winget`, Windows shortcut creation, and native PowerShell execution require a real Windows 10/11 acceptance pass. The installer is written for Windows PowerShell 5.1 compatibility and does not depend on PowerShell 7 syntax.
