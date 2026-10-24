$ErrorActionPreference = "Stop"
$InstallDir = Join-Path $env:LOCALAPPDATA "ForgePilot"
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$Parts = @($UserPath -split ';' | Where-Object { $_ -and $_ -ne $InstallDir })
[Environment]::SetEnvironmentVariable("Path", ($Parts -join ';'), "User")
$shortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "ForgePilot.lnk"
if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
Write-Host "ForgePilot removed from $InstallDir"
Write-Host "Your Documents\\ForgePilot Workspace folder was left intact."
