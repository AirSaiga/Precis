@echo off
chcp 65001 >nul
title Precis - Electron (Dev)
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis - Electron (Dev)
echo ============================================
echo.

call node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js ^(^>=20.19.0 ^|^| ^>=22.12.0^).
    pause
    exit /b 1
)
for /f "tokens=*" %%a in ('node --version') do echo [OK] Node.js: %%a
echo.

echo [INFO] This script launches Electron only.
echo   For dev mode, start backend and frontend first:
echo     - Backend:  start-backend.bat (dynamic port, see backend/.backend-port)
echo     - Frontend: start-frontend.bat (port 5173 or VITE_FRONTEND_PORT from .env)
echo   For full stack (backend + frontend + Electron), use start-dev.bat instead.
echo.
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

:: Force dev mode: reuse the externally started backend + Vite dev server even when
:: a stale frontend/dist build exists (otherwise Electron spawns its own backend).
set PRECIS_FORCE_DEV=1
cd electron
npm start

echo.
echo [INFO] Electron stopped.
pause >nul
exit /b %ERRORLEVEL%
