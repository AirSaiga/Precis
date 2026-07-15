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
