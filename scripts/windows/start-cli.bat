@echo off
chcp 65001 >nul
title Precis - CLI (Interactive)
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis - CLI (Interactive)
echo ============================================
echo.

call python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python ^(3.13+^).
    pause
    exit /b 1
)
for /f "tokens=2" %%a in ('python --version') do echo [OK] Python: %%a
echo.

cd backend
if exist ".venv\Scripts\python.exe" (
    .venv\Scripts\python.exe -B app\cli_main.py %*
) else (
    python -B app\cli_main.py %*
)

echo.
if %ERRORLEVEL% neq 0 (
    echo [ERROR] CLI exited with code %ERRORLEVEL%.
)
pause >nul
exit /b %ERRORLEVEL%