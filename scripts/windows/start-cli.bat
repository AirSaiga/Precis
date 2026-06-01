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

:: Prefer backend venv Python when available
if exist "backend\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=backend\.venv\Scripts\python.exe"
    echo [OK] Using venv Python: backend\.venv
) else (
    call python --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python not found. Please install Python ^(3.12+^) or run scripts\setup.ps1.
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
    echo [WARN] No venv found, falling back to system Python.
)
for /f "tokens=*" %%a in ('"%PYTHON_CMD%" --version') do echo [OK] %%a
echo.

cd backend
"%PYTHON_CMD%" -B app\cli_main.py %*

echo.
if %ERRORLEVEL% neq 0 (
    echo [ERROR] CLI exited with code %ERRORLEVEL%.
)
pause >nul
exit /b %ERRORLEVEL%
