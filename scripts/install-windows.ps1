$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "install-one-click.ps1")
exit $LASTEXITCODE
