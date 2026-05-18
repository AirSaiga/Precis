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
    echo [ERROR] Node.js not found. Please install Node.js ^(20.19.0+^).
    pause
    exit /b 1
)
for /f "tokens=1" %%a in ('node --version') do echo [OK] Node.js: %%a
echo.

echo [INFO] Ensure the backend and frontend dev servers are running first:
echo   - Backend: http://127.0.0.1:18000
echo   - Frontend: http://localhost:5173
echo.

if not exist "electron\dist\main.js" (
    echo [INFO] Compiling Electron TypeScript...
    cd electron
    call npm run build:electron
    if errorlevel 1 (
        echo [ERROR] Electron compilation failed.
        pause
        exit /b 1
    )
    cd "%PROJECT_ROOT%"
)

cd electron
npm start

echo.
echo [INFO] Electron stopped.
pause >nul
exit /b %ERRORLEVEL%
