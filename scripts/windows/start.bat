@echo off
chcp 65001 >nul
title Precis
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

:: Prefer backend venv Python when available
:: NOTE: an absolute path based on PROJECT_ROOT is required here, because the script later
:: runs `cd backend`, where the relative path backend\.venv\... would fail (backend\backend\.venv\...).
if exist "%PROJECT_ROOT%\backend\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=%PROJECT_ROOT%\backend\.venv\Scripts\python.exe"
) else (
    set "PYTHON_CMD=python"
)

:: Ensure frontend build exists
if not exist "frontend\dist\index.html" (
    echo [INFO] Building frontend...
    cd frontend
    call npm run build >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Frontend build failed.
        pause
        exit /b 1
    )
    cd "%PROJECT_ROOT%"
)

:: Ensure electron is compiled
if not exist "electron\dist\main.js" (
    echo [INFO] Compiling Electron TypeScript...
    cd electron
    call npm run build:electron >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Electron compilation failed.
        pause
        exit /b 1
    )
    cd "%PROJECT_ROOT%"
)

:: Start Electron (backend is managed by Electron itself, port dynamically allocated)
:: Production/standard mode: with frontend build output present, Electron spawns the backend itself
:: and discovers its port via the port-file protocol. No external backend or wait-on needed.
cd electron && npx electron .

exit /b %ERRORLEVEL%
