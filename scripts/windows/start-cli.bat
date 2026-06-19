@echo off
chcp 65001 >nul
title Precis - CLI (Interactive)
setlocal

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis - CLI (Interactive)
echo ============================================
echo.

:: Prefer backend venv Python when available
if exist "%PROJECT_ROOT%\backend\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=%PROJECT_ROOT%\backend\.venv\Scripts\python.exe"
    echo [OK] Using venv Python: backend\.venv
) else (
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python not found. Please install Python ^(3.12+^) or run scripts\setup.ps1.
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
    echo [WARN] No venv found, falling back to system Python.
)
for /f "tokens=*" %%a in ('"%PYTHON_CMD%" --version 2^>^&1') do echo [OK] Python: %%a
echo.

:: Default: single run (set AUTO_RESTART=1 to enable auto-restart loop)
if /i "%AUTO_RESTART%"=="1" goto :main_loop

:single_run
cd /d "%PROJECT_ROOT%\backend"
"%PYTHON_CMD%" -B app\cli_main.py %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if %EXIT_CODE% neq 0 (
    echo [ERROR] CLI exited with code %EXIT_CODE%.
)
pause
exit /b %EXIT_CODE%

:main_loop
cd /d "%PROJECT_ROOT%\backend"
"%PYTHON_CMD%" -B app\cli_main.py %*

echo.
if %ERRORLEVEL% neq 0 (
    echo [ERROR] CLI exited with code %ERRORLEVEL%.
)
echo.
echo [INFO] Restarting in 1s... (close this window or Ctrl+C to stop)
timeout /t 1 /nobreak >nul
goto :main_loop
