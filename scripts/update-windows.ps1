param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Api = "https://api.github.com/repos/fuhrdan/ForgePilot/releases/latest"
$CurrentRoot = Split-Path -Parent $PSScriptRoot
$CurrentPackage = Get-Content (Join-Path $CurrentRoot "package.json") -Raw | ConvertFrom-Json
$CurrentVersion = [string]$CurrentPackage.version

Write-Host "ForgePilot $CurrentVersion update"
Write-Host "Checking the latest GitHub Release..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$release = Invoke-RestMethod -UseBasicParsing -Uri $Api -Headers @{ "User-Agent" = "ForgePilot/$CurrentVersion" } -TimeoutSec 20
$latest = ([string]$release.tag_name).TrimStart('v')
if (-not $latest) { throw "GitHub did not return a release version." }
if (-not $Force -and ([version]$latest -le [version]$CurrentVersion)) {
    Write-Host "ForgePilot is current ($CurrentVersion)."
    exit 0
}

$zipName = "ForgePilot-v$latest-windows.zip"
$shaName = "$zipName.sha256"
$zipAsset = $release.assets | Where-Object { $_.name -eq $zipName } | Select-Object -First 1
$shaAsset = $release.assets | Where-Object { $_.name -eq $shaName } | Select-Object -First 1
if (-not $zipAsset -or -not $shaAsset) { throw "Release $latest does not contain the expected Windows ZIP and SHA-256 assets." }

$tempRoot = Join-Path $env:TEMP ("forgepilot-update-" + [Guid]::NewGuid().ToString('N'))
New-Item $tempRoot -ItemType Directory -Force | Out-Null
$zipPath = Join-Path $tempRoot $zipName
$shaPath = Join-Path $tempRoot $shaName
try {
    Write-Host "Downloading ForgePilot $latest..."
    Invoke-WebRequest -UseBasicParsing -Uri $zipAsset.browser_download_url -OutFile $zipPath -TimeoutSec 180
    Invoke-WebRequest -UseBasicParsing -Uri $shaAsset.browser_download_url -OutFile $shaPath -TimeoutSec 30

    $expected = ((Get-Content $shaPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "Downloaded release checksum mismatch. Expected $expected, got $actual." }
    Write-Host "SHA-256 verified."

    $extract = Join-Path $tempRoot "extract"
    Expand-Archive -Path $zipPath -DestinationPath $extract -Force
    $releaseRoot = Get-ChildItem $extract -Directory | Where-Object { Test-Path (Join-Path $_.FullName "scripts\install-one-click.ps1") } | Select-Object -First 1
    if (-not $releaseRoot) { throw "Downloaded release did not contain a valid ForgePilot installer." }

    Write-Host "Installing ForgePilot $latest while preserving config/log/runtime state..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $releaseRoot.FullName "scripts\install-one-click.ps1") -SkipModelPull
    if ($LASTEXITCODE -ne 0) { throw "ForgePilot $latest installer returned exit code $LASTEXITCODE." }
    Write-Host "ForgePilot update complete."
} finally {
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
