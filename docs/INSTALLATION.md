# Installation

## Windows release install

The supported end-user installation path is the ZIP attached to a ForgePilot GitHub Release.

1. Download `ForgePilot-vX.Y.Z-windows.zip`.
2. Extract it to a normal local folder.
3. Double-click `INSTALL_FORGEPILOT.cmd`.
4. Allow the installer to inspect the PC and configure a conservative runtime profile.
5. Use the ForgePilot desktop shortcut for normal launches.

The installer copies ForgePilot to `%LOCALAPPDATA%\ForgePilot`, creates a workspace under Documents, creates a user-level launcher, and does not require Administrator rights for the normal path.

### Prerequisites

ForgePilot requires Node.js 22+. The one-click installer tries, in order:

1. an already installed compatible Node.js;
2. `winget` for Node.js LTS;
3. a private portable Node.js runtime under ForgePilot's install directory.

Git is recommended and installed best-effort when `winget` is available.

Ollama is optional. If available, ForgePilot can use local coding models and will select a conservative model based on current resources.

## Verify an installation

```powershell
forgepilot --version
forgepilot health
forgepilot doctor
```

## Uninstall

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows.ps1
```

or remove `%LOCALAPPDATA%\ForgePilot` after closing ForgePilot. Review your Documents `ForgePilot Workspace` separately before deleting it because it may contain projects you created.
