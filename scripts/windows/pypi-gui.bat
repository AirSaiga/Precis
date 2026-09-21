@echo off
chcp 65001 >nul
title Precis - PyPI Console
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis PyPI Console (GUI)
echo ============================================
echo.

call node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js ^(^>=20.19.0 ^|^| ^>=22.12.0 ^).
    pause
    exit /b 1
)
for /f "tokens=*" %%a in ('node --version') do echo [OK] Node.js: %%a
echo.
echo [INFO] Starting PyPI console...
echo   - Browser opens automatically at http://127.0.0.1:17889
echo   - Keep this window open while using the console
echo   - Close this window (or Ctrl+C) to stop the console
echo.

call node scripts\pypi-gui.mjs %*
if errorlevel 1 (
    echo.
    echo [ERROR] PyPI console exited with an error.
    pause
)

echo.
echo [INFO] PyPI console stopped.
pause >nul
exit /b %ERRORLEVEL%
