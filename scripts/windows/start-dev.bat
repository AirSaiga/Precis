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
    set "PYTHON_CMD=backend\.venv\Scripts\python.exe"
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

:: 后端端口由 OS 动态分配(start_server.py --port 0),无需读取 .env 后端端口
for /f "tokens=*" %%a in ('node -e "try { require('dotenv').config(); } catch(e) {} console.log(process.env.VITE_FRONTEND_PORT || '5173')"') do set FRONTEND_PORT=%%a

:: 后端走统一启动脚本,动态端口永不冲突,无需 free-port 预清理。
:: Electron 自行通过端口文件协议发现后端,无需 wait-on 后端 /docs;
:: 此处仅等待前端端口就绪后启动 Electron。
call npx concurrently --kill-others --names "BACKEND,FRONTEND,ELECTRON" --prefix-colors "cyan,green,magenta" "cd backend && %PYTHON_CMD% app/start_server.py --reload" "cd frontend && npm run dev" "npx wait-on --delay 1000 --timeout 60000 http://localhost:%FRONTEND_PORT% && cd electron && npm start"

echo.
echo [INFO] All services stopped.
pause >nul
exit /b %ERRORLEVEL%
