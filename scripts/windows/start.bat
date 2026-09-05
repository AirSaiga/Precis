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

:: Rebuild frontend when dist is missing OR sources are newer than the last build.
:: "Build only if missing" silently served stale bundles after source edits (the
:: same stale-artifact defect class as the 2026-09 packaging chain fix).
:: Detection defaults to STALE when PowerShell is unavailable (fail closed).
:: NOTE: error handling uses a flag + top-level exit /b. An exit /b inside the
:: nested blocks empirically lost its exit code under cmd /c in some shapes.
set "FRONTEND_STALE=STALE"
if exist "frontend\dist\index.html" (
    for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $newest = Get-ChildItem -Recurse -File 'frontend\src','frontend\index.html','frontend\vite.config.ts','frontend\package.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $stamp = Get-Item 'frontend\dist\index.html'; if ($newest -and $stamp -and $newest.LastWriteTime -gt $stamp.LastWriteTime) {'STALE'} else {'FRESH'}"`) do set "FRONTEND_STALE=%%R"
)
set "FRONTEND_BUILD_FAILED=0"
if "!FRONTEND_STALE!"=="STALE" (
    echo [INFO] Building frontend - dist missing or sources changed...
    cd frontend
    call npm run build > "%TEMP%\precis-frontend-build.log" 2>&1
    if not "!errorlevel!"=="0" set "FRONTEND_BUILD_FAILED=1"
    cd "%PROJECT_ROOT%"
) else (
    echo [INFO] Frontend dist up to date - skipping build.
)
if "!FRONTEND_BUILD_FAILED!"=="1" (
    echo [ERROR] Frontend build failed. Last output:
    powershell -NoProfile -Command "Get-Content -Path \"$env:TEMP\precis-frontend-build.log\" -Tail 25"
    rem Drop the partial stamp so the next run rebuilds instead of trusting it
    del "frontend\dist\index.html" >nul 2>&1
    pause
    exit /b 1
)

:: Recompile Electron main when missing OR sources are newer than the last compile.
set "ELECTRON_STALE=STALE"
if exist "electron\dist\main.js" (
    for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; $newest = Get-ChildItem -Recurse -File 'electron\src','electron\package.json','electron\tsconfig.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $stamp = Get-Item 'electron\dist\main.js'; if ($newest -and $stamp -and $newest.LastWriteTime -gt $stamp.LastWriteTime) {'STALE'} else {'FRESH'}"`) do set "ELECTRON_STALE=%%R"
)
set "ELECTRON_BUILD_FAILED=0"
if "!ELECTRON_STALE!"=="STALE" (
    echo [INFO] Compiling Electron TypeScript - dist missing or sources changed...
    cd electron
    call npm run build:electron > "%TEMP%\precis-electron-build.log" 2>&1
    if not "!errorlevel!"=="0" set "ELECTRON_BUILD_FAILED=1"
    cd "%PROJECT_ROOT%"
) else (
    echo [INFO] Electron dist up to date - skipping compile.
)
if "!ELECTRON_BUILD_FAILED!"=="1" (
    echo [ERROR] Electron compilation failed. Last output:
    powershell -NoProfile -Command "Get-Content -Path \"$env:TEMP\precis-electron-build.log\" -Tail 25"
    rem Drop the partial stamp so the next run rebuilds instead of trusting it
    del "electron\dist\main.js" >nul 2>&1
    pause
    exit /b 1
)

:: Start Electron (backend is managed by Electron itself, port dynamically allocated)
:: Production/standard mode: with frontend build output present, Electron spawns the backend itself
:: and discovers its port via the port-file protocol. No external backend or wait-on needed.
cd electron && npx electron .

exit /b %ERRORLEVEL%
