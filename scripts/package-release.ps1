param(
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Package = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
$Version = [string]$Package.version
$Dist = Join-Path $Root "dist"
$StageRoot = Join-Path $Dist "stage"
$Stage = Join-Path $StageRoot "ForgePilot-v$Version"
$Zip = Join-Path $Dist "ForgePilot-v$Version-windows.zip"
$Checksum = "$Zip.sha256"

Push-Location $Root
try {
    node .\scripts\release-check.mjs
    if ($LASTEXITCODE -ne 0) { throw "Release-readiness check failed." }

    if (-not $SkipTests) {
        npm run test:ci
        if ($LASTEXITCODE -ne 0) { throw "Test suite failed." }
    }

    if (Test-Path $StageRoot) { Remove-Item $StageRoot -Recurse -Force }
    if (Test-Path $Zip) { Remove-Item $Zip -Force }
    if (Test-Path $Checksum) { Remove-Item $Checksum -Force }
    New-Item $Stage -ItemType Directory -Force | Out-Null

    $topFiles = @(
        ".editorconfig", ".gitattributes", ".gitignore",
        "CHANGELOG.md", "CODE_OF_CONDUCT.md", "CONTRIBUTING.md",
        "INSTALL_FORGEPILOT.cmd", "LICENSE", "README.md",
        "RUN_FORGEPILOT.cmd", "SECURITY.md", "SUPPORT.md", "package.json"
    )
    foreach ($file in $topFiles) {
        $src = Join-Path $Root $file
        if (Test-Path $src) { Copy-Item $src (Join-Path $Stage $file) -Force }
    }

    foreach ($dir in @("docs", "examples", "scripts", "src")) {
        Copy-Item (Join-Path $Root $dir) (Join-Path $Stage $dir) -Recurse -Force
    }

    Copy-Item (Join-Path $Root "docs\releases\v$Version.md") (Join-Path $Stage "RELEASE_NOTES.md") -Force

    Compress-Archive -Path $Stage -DestinationPath $Zip -CompressionLevel Optimal

    $hash = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path $Zip -Leaf)" | Set-Content $Checksum -Encoding ASCII

    Write-Host "Release package: $Zip"
    Write-Host "SHA-256: $hash"
} finally {
    Pop-Location
    if (Test-Path $StageRoot) { Remove-Item $StageRoot -Recurse -Force }
}
