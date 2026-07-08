@echo off
chcp 65001 >nul
title Precis - TUI (Terminal UI)

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis - TUI (Terminal UI)
echo ============================================
echo.

:: Prefer backend venv Python when available
if exist "%PROJECT_ROOT%\backend\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=%PROJECT_ROOT%\backend\.venv\Scripts\python.exe"
    echo [OK] Using venv Python: backend\.venv
) else (
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python not found. Please install Python 3.12+ or run scripts\setup.ps1.
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
    echo [WARN] No venv found, falling back to system Python.
)
for /f "tokens=*" %%a in ('%PYTHON_CMD% --version 2^>^&1') do echo [OK] Python: %%a
echo.

cd /d "%PROJECT_ROOT%\backend"
%PYTHON_CMD% -B -m app.cli.tui
set "EXIT_CODE=%ERRORLEVEL%"
echo.

if "%EXIT_CODE%"=="0" (
    echo [INFO] TUI closed normally.
) else (
    echo [ERROR] TUI exited with code %EXIT_CODE%.
    echo.
    echo If it crashed on startup:
    echo   - Make sure textual is installed: cd backend ^&^& pip install -e ".[dev]"
    echo   - Try a modern terminal (Windows Terminal recommended)
    pause
)
exit /b %EXIT_CODE%
