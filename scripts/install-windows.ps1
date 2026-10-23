$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Package = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) { throw "Node.js 22+ is required. Install Node.js and rerun this installer." }
$NodeVersion = (& node -p "process.versions.node").Trim()
$Major = [int]($NodeVersion.Split('.')[0])
if ($Major -lt 22) { throw "Node.js 22+ is required; found $NodeVersion." }

$InstallDir = Join-Path $env:LOCALAPPDATA "ForgePilot"
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
New-Item $InstallDir -ItemType Directory -Force | Out-Null

Get-ChildItem $Root -Force | Where-Object { $_.Name -notin @('.git','.forgepilot','node_modules','work') } | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $InstallDir $_.Name) -Recurse -Force
}

$Launcher = @"
@echo off
node "%LOCALAPPDATA%\ForgePilot\src\cli.js" %*
"@
Set-Content (Join-Path $InstallDir "forgepilot.cmd") $Launcher -Encoding ASCII

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$Parts = @($UserPath -split ';' | Where-Object { $_ })
if ($Parts -notcontains $InstallDir) {
    $NewPath = (($Parts + $InstallDir) -join ';')
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
}

Write-Host "ForgePilot $($Package.version) installed to $InstallDir"
Write-Host "Open a new terminal and run: forgepilot doctor"
