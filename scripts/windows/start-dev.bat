@echo off
chcp 65001 >nul
title Precis - Development
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis (Development)
echo ============================================
echo.

call node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js ^(^>=20.19.0 ^|^| ^>=22.12.0^).
    pause
    exit /b 1
)
for /f "tokens=*" %%a in ('node --version') do echo [OK] Node.js: %%a

:: Prefer backend venv Python when available
if exist "backend\.venv\Scripts\python.exe" (
    set "PYTHON_CMD=%PROJECT_ROOT%\backend\.venv\Scripts\python.exe"
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
echo [INFO] Starting services...
echo.

:: Compile Electron main when missing OR sources are newer than the last compile
:: ("exists → skip" silently ran a stale main process after source edits).
:: Detection defaults to STALE when PowerShell is unavailable (fail closed).
set "ELECTRON_STALE=STALE"
if exist "electron\dist\main.js" (
    for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $newest = Get-ChildItem -Recurse -File 'electron\src','electron\package.json','electron\tsconfig.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $stamp = Get-Item 'electron\dist\main.js'; if ($newest -and $stamp -and $newest.LastWriteTime -gt $stamp.LastWriteTime) {'STALE'} else {'FRESH'}"`) do set "ELECTRON_STALE=%%R"
)
set "ELECTRON_BUILD_FAILED=0"
if "!ELECTRON_STALE!"=="STALE" (
    echo [INFO] Compiling Electron TypeScript - dist missing or sources changed...
    cd electron
    call npm run build:electron
    if not "!errorlevel!"=="0" set "ELECTRON_BUILD_FAILED=1"
    cd "%PROJECT_ROOT%"
) else (
    echo [INFO] Electron dist up to date - skipping compile.
)
if "!ELECTRON_BUILD_FAILED!"=="1" (
    echo [ERROR] Electron compilation failed.
    rem Drop the partial stamp so the next run rebuilds instead of trusting it
    del "electron\dist\main.js" >nul 2>&1
    pause
    exit /b 1
)

:: Backend port is OS-assigned (start_server.py --port 0); no backend port is read from .env
for /f "tokens=*" %%a in ('node -e "try { require('dotenv').config(); } catch(e) {} console.log(process.env.VITE_FRONTEND_PORT || '5173')"') do set FRONTEND_PORT=%%a

:: Backend uses the unified start script; dynamic ports never conflict, so no free-port pre-clean.
:: Electron discovers the backend via the port-file protocol, so no wait-on for backend /docs;
:: only the frontend port is awaited before launching Electron.
:: Force Electron into dev mode even when a stale frontend/dist build exists
:: (otherwise it would spawn its own backend and load the static build instead of Vite).
set PRECIS_FORCE_DEV=1
call npx concurrently --kill-others --names "BACKEND,FRONTEND,ELECTRON" --prefix-colors "cyan,green,magenta" "cd backend && %PYTHON_CMD% app/start_server.py --reload" "cd frontend && npm run dev" "npx wait-on --delay 1000 --timeout 60000 http://localhost:%FRONTEND_PORT% && cd electron && npm start"

echo.
echo [INFO] All services stopped.
pause >nul
exit /b %ERRORLEVEL%
