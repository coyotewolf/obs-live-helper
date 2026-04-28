@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OBS Live Helper - One-click Launcher

echo ======================================
echo  OBS Live Helper - one-click launcher
echo ======================================
echo.
echo This will prepare a local portable Node.js if needed,
echo install dependencies, prepare security files, and start the helper.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-launcher.ps1"

echo.
echo Launcher finished or stopped.
pause
