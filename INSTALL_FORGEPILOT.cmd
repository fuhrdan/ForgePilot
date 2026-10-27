@echo off
setlocal
cd /d "%~dp0"
title ForgePilot v0.19.0 Installer
echo ============================================================
echo  ForgePilot v0.19.0 - One-Click Windows Installer
echo ============================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-one-click.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo ForgePilot installation did not complete. Error code: %RC%
  echo See the messages above for the prerequisite that could not be installed.
  pause
  exit /b %RC%
)
echo Installation complete. A ForgePilot shortcut has been created on your Desktop.
echo Double-click it whenever you want to run ForgePilot.
pause
