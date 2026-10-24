@echo off
setlocal
set "INST=%LOCALAPPDATA%\ForgePilot"
if exist "%INST%\scripts\run-one-click.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INST%\scripts\run-one-click.ps1"
  exit /b %ERRORLEVEL%
)
cd /d "%~dp0"
if not exist ".\src\cli.js" (
  echo ForgePilot is not installed. Double-click INSTALL_FORGEPILOT.cmd first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-one-click.ps1" -PortableRoot "%~dp0"
