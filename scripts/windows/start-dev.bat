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
    echo [ERROR] Node.js not found. Please install Node.js ^(20.19.0+^).
    pause
    exit /b 1
)
for /f "tokens=1" %%a in ('node --version') do echo [OK] Node.js: %%a

call python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python ^(3.13+^).
    pause
    exit /b 1
)
for /f "tokens=2" %%a in ('python --version') do echo [OK] Python: %%a

echo.
echo [INFO] Starting services...
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

call npx concurrently --kill-others --names "BACKEND,FRONTEND,ELECTRON" --prefix-colors "cyan,green,magenta" "cd backend && python -m uvicorn app.api.main:app --reload --port 18000" "cd frontend && npm run dev" "npx wait-on --delay 1000 --timeout 60000 http://127.0.0.1:18000/docs http://localhost:5173 && cd electron && npm start"

echo.
echo [INFO] All services stopped.
pause >nul
exit /b %ERRORLEVEL%
