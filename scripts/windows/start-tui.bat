@echo off
chcp 65001 >nul
title Precis - TUI

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis - TUI (Terminal UI)
echo ============================================
echo.

:: Find Python (venv first, then pyenv, then system)
set "PYTHON_CMD="

if exist "%PROJECT_ROOT%\backend\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=%PROJECT_ROOT%\backend\.venv\Scripts\python.exe"
    echo [OK] Using backend venv Python.
) else if exist "C:\Users\%USERNAME%\.pyenv\pyenv-win\versions\3.13.5\python.exe" (
    set "PYTHON_CMD=C:\Users\%USERNAME%\.pyenv\pyenv-win\versions\3.13.5\python.exe"
    echo [OK] Using pyenv Python 3.13.5.
) else (
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python not found. Install Python 3.12+ or run scripts\setup.ps1.
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
    echo [WARN] No venv found, using system Python.
)

:: Check textual is installed
"%PYTHON_CMD%" -c "import textual" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] textual not installed.
    echo Run: cd backend ^&^& pip install -e ".[dev]"
    pause
    exit /b 1
)
echo [OK] textual available.
echo.

cd /d "%PROJECT_ROOT%\backend"
echo [START] Launching TUI...
echo.

"%PYTHON_CMD%" -B -m app.cli.tui
set "EXIT_CODE=%ERRORLEVEL%"
echo.

if "%EXIT_CODE%"=="0" (
    echo [INFO] TUI closed normally.
) else (
    echo [ERROR] TUI exited with code %EXIT_CODE%.
)
echo.
pause
exit /b %EXIT_CODE%
