param(
    [switch]$SkipAI,
    [switch]$SkipModelPull
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA "ForgePilot"
$Workspace = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "ForgePilot Workspace"
$LogDir = Join-Path $InstallDir "logs"

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Find-Exe([string]$Name, [string[]]$Candidates = @()) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($candidate in $Candidates) {
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path $expanded) { return $expanded }
    }
    return $null
}


function Test-Node22([string]$Path) {
    if (-not $Path -or -not (Test-Path $Path)) { return $false }
    try {
        $major = [int]((& $Path -p "process.versions.node").Trim().Split('.')[0])
        return ($major -ge 22)
    } catch {
        return $false
    }
}

function Install-WithWinget([string]$Id, [string]$Label) {
    $winget = Find-Exe "winget.exe"
    if (-not $winget) { return $false }
    Write-Host "Installing $Label..."
    & $winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    Refresh-Path
    return ($LASTEXITCODE -eq 0)
}

function Install-PortableNode {
    Write-Host "winget Node.js install unavailable; trying a portable Node.js LTS runtime..."
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $index = Invoke-RestMethod -UseBasicParsing -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 30
        $release = $index | Where-Object { $_.lts -and ([int]($_.version.TrimStart('v').Split('.')[0]) -ge 22) } | Select-Object -First 1
        if (-not $release) { return $null }
        $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'arm64' } else { 'x64' }
        $file = "node-$($release.version)-win-$arch.zip"
        $uri = "https://nodejs.org/dist/$($release.version)/$file"
        $tempZip = Join-Path $env:TEMP "forgepilot-$file"
        $extractRoot = Join-Path $env:TEMP ("forgepilot-node-" + [Guid]::NewGuid().ToString('N'))
        Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $tempZip -TimeoutSec 120
        Expand-Archive -Path $tempZip -DestinationPath $extractRoot -Force
        $sourceDir = Get-ChildItem $extractRoot -Directory | Select-Object -First 1
        if (-not $sourceDir) { return $null }
        $runtimeDir = Join-Path $InstallDir "runtime\node"
        if (Test-Path $runtimeDir) { Remove-Item $runtimeDir -Recurse -Force }
        New-Item $runtimeDir -ItemType Directory -Force | Out-Null
        Copy-Item (Join-Path $sourceDir.FullName '*') $runtimeDir -Recurse -Force
        Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
        Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
        $portableNode = Join-Path $runtimeDir "node.exe"
        if (Test-Path $portableNode) { return $portableNode }
    } catch {
        Write-Warning "Portable Node.js bootstrap failed: $($_.Exception.Message)"
    }
    return $null
}

Write-Host "[1/7] Checking Windows prerequisites..."
$node = Find-Exe "node.exe" @("%ProgramFiles%\nodejs\node.exe", "%LOCALAPPDATA%\Programs\nodejs\node.exe")
$nodeOk = Test-Node22 $node
if (-not $nodeOk) {
    $wingetNode = Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
    if ($wingetNode) {
        $candidateNode = Find-Exe "node.exe" @("%ProgramFiles%\nodejs\node.exe", "%LOCALAPPDATA%\Programs\nodejs\node.exe")
        if (Test-Node22 $candidateNode) { $node = $candidateNode } else { $node = $null }
    } else {
        $node = $null
    }
    if (-not $node) { $node = Install-PortableNode }
    if (-not (Test-Node22 $node)) {
        throw "Node.js 22+ was not found and both winget and portable Node.js bootstrap failed. Check Internet access and rerun INSTALL_FORGEPILOT.cmd."
    }
}
$env:Path = "$(Split-Path -Parent $node);$env:Path"

$git = Find-Exe "git.exe" @("%ProgramFiles%\Git\cmd\git.exe", "%LOCALAPPDATA%\Programs\Git\cmd\git.exe")
if (-not $git) {
    [void](Install-WithWinget "Git.Git" "Git")
    $git = Find-Exe "git.exe" @("%ProgramFiles%\Git\cmd\git.exe", "%LOCALAPPDATA%\Programs\Git\cmd\git.exe")
}

Write-Host "[2/7] Installing ForgePilot to $InstallDir..."
if (Test-Path $InstallDir) {
    Get-ChildItem $InstallDir -Force | Where-Object { $_.Name -notin @('config','logs','runtime') } | Remove-Item -Recurse -Force
} else {
    New-Item $InstallDir -ItemType Directory -Force | Out-Null
}
Get-ChildItem $Root -Force | Where-Object { $_.Name -notin @('.git','.forgepilot','node_modules','work') } | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $InstallDir $_.Name) -Recurse -Force
}
New-Item $Workspace -ItemType Directory -Force | Out-Null
New-Item $LogDir -ItemType Directory -Force | Out-Null

$Launcher = @"
@echo off
setlocal
set "FORGEPILOT_HOME=%LOCALAPPDATA%\ForgePilot"
if exist "%LOCALAPPDATA%\ForgePilot\config\launcher-env.cmd" call "%LOCALAPPDATA%\ForgePilot\config\launcher-env.cmd"
"$node" "%LOCALAPPDATA%\ForgePilot\src\cli.js" %*
"@
Set-Content (Join-Path $InstallDir "forgepilot.cmd") $Launcher -Encoding ASCII

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $InstallDir) {
    [Environment]::SetEnvironmentVariable("Path", (($parts + $InstallDir) -join ';'), "User")
}
Refresh-Path

Write-Host "[3/7] Inspecting this PC and selecting a safe runtime profile..."
$env:FORGEPILOT_HOME = $InstallDir
& $node (Join-Path $InstallDir "src\cli.js") setup
if ($LASTEXITCODE -ne 0) { throw "ForgePilot system inspection failed." }
$configPath = Join-Path $InstallDir "config\machine-profile.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

Write-Host "[4/7] Checking optional local AI runtime..."
$ollama = Find-Exe "ollama.exe" @("%LOCALAPPDATA%\Programs\Ollama\ollama.exe", "%ProgramFiles%\Ollama\ollama.exe")
if (-not $SkipAI -and -not $ollama) {
    [void](Install-WithWinget "Ollama.Ollama" "Ollama")
    $ollama = Find-Exe "ollama.exe" @("%LOCALAPPDATA%\Programs\Ollama\ollama.exe", "%ProgramFiles%\Ollama\ollama.exe")
}

if (-not $SkipAI -and $ollama -and -not $SkipModelPull) {
    $model = [string]$config.bootstrapModel
    $freeDisk = 0
    if ($null -ne $config.hardware.disk.freeGiB) { $freeDisk = [double]$config.hardware.disk.freeGiB }
    if ($model -and ($freeDisk -eq 0 -or $freeDisk -ge 8)) {
        Write-Host "[5/7] Preparing low-impact local coding model: $model"
        try {
            & $ollama pull $model
            if ($LASTEXITCODE -ne 0) { Write-Warning "Model pull did not complete. ForgePilot is installed; you can run 'ollama pull $model' later." }
        } catch {
            Write-Warning "Could not pull $model. ForgePilot remains installed and can run deterministic tasks now."
        }
    } else {
        Write-Warning "Skipping AI model download because free disk is low. Recommended bootstrap model: $model"
    }
} else {
    Write-Host "[5/7] AI model bootstrap skipped or Ollama unavailable."
}

# Re-run inspection after optional installs so tool availability is current.
& $node (Join-Path $InstallDir "src\cli.js") setup | Out-Host

Write-Host "[6/7] Creating one-click launcher..."
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "ForgePilot.lnk"
$wshell = New-Object -ComObject WScript.Shell
$shortcut = $wshell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $InstallDir "RUN_FORGEPILOT.cmd"
$shortcut.WorkingDirectory = $Workspace
$shortcut.Description = "Run ForgePilot"
$shortcut.Save()

Write-Host "[7/7] Verifying installation..."
$version = (& $node (Join-Path $InstallDir "src\cli.js") --version).Trim()
if ($version -ne "0.11.0") { throw "Installed ForgePilot version check failed: $version" }

$summary = @"
ForgePilot $version installed successfully.
Install: $InstallDir
Workspace: $Workspace
Desktop shortcut: $shortcutPath
Machine tier: $($config.tier)
Recommended model: $($config.model)
Bootstrap model: $($config.bootstrapModel)
Node: $node
Git: $(if ($git) {$git} else {'not detected'})
Ollama: $(if ($ollama) {$ollama} else {'not detected - AI tasks can be enabled later'})
"@
$summary | Tee-Object -FilePath (Join-Path $LogDir "install-summary.txt") | Out-Host
