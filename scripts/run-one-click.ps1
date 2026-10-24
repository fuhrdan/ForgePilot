param([string]$PortableRoot)
$ErrorActionPreference = "Stop"
$InstallDir = if ($PortableRoot) { $PortableRoot.TrimEnd('\') } else { Join-Path $env:LOCALAPPDATA "ForgePilot" }
$env:FORGEPILOT_HOME = $InstallDir
$Workspace = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "ForgePilot Workspace"
New-Item $Workspace -ItemType Directory -Force | Out-Null

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    $candidate = Join-Path $env:ProgramFiles "nodejs\node.exe"
    if (Test-Path $candidate) { $node = Get-Item $candidate }
}
if (-not $node) {
    $candidate = Join-Path $InstallDir "runtime\node\node.exe"
    if (Test-Path $candidate) { $node = Get-Item $candidate }
}
if (-not $node) { throw "Node.js could not be found. Run INSTALL_FORGEPILOT.cmd again." }
$nodePath = if ($node.Source) { $node.Source } else { $node.FullName }

# Refresh the adaptive machine plan on every desktop launch so current free RAM and newly installed tools are reflected.
& $nodePath (Join-Path $InstallDir "src\cli.js") setup | Out-Null
$configPath = Join-Path $InstallDir "config\machine-profile.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$env:FORGEPILOT_PROFILE = [string]$config.profile
$env:FORGEPILOT_MODEL = [string]$config.model
$env:OLLAMA_NUM_PARALLEL = [string]$config.ollama.numParallel
$env:OLLAMA_MAX_LOADED_MODELS = [string]$config.ollama.maxLoadedModels
$env:OLLAMA_KEEP_ALIVE = [string]$config.ollama.keepAlive

# Start Ollama only when installed and not already answering locally. This remains process-local and optional.
$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) {
    $candidate = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path $candidate) { $ollama = Get-Item $candidate }
}
if ($ollama) {
    $alive = $false
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:11434/api/tags; $alive = ($r.StatusCode -eq 200) } catch {}
    if (-not $alive) {
        $ollamaPath = if ($ollama.Source) { $ollama.Source } else { $ollama.FullName }
        Start-Process -FilePath $ollamaPath -ArgumentList "serve" -WindowStyle Hidden | Out-Null
        Start-Sleep -Milliseconds 800
    }
}

Write-Host "ForgePilot v0.14.0"
Write-Host "Machine tier: $($config.tier)"
Write-Host "RAM: $($config.hardware.memoryGiB) GiB total / $($config.hardware.availableMemoryGiB) GiB currently available"
Write-Host "Model: $($config.model)"
Write-Host "Workspace: $Workspace"
Write-Host "Runtime health:"
& $nodePath (Join-Path $InstallDir "src\cli.js") health $Workspace | Out-Host
Write-Host "Opening local ForgePilot dashboard..."
Write-Host "Close this window to stop the dashboard."
& $nodePath (Join-Path $InstallDir "src\cli.js") launch $Workspace --port 0
