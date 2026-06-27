@echo off
chcp 65001 >nul
title Precis
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

:: Prefer backend venv Python when available
:: 注意: 必须使用相对 PROJECT_ROOT 的绝对路径，因为后续会 `cd backend`，
:: 此时相对路径 backend\.venv\... 会被解析成 backend\backend\.venv\... 而失效。
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

:: Start backend and electron (frontend is served statically by electron)
for /f "tokens=*" %%a in ('node -e "try { require('dotenv').config(); } catch(e) {} console.log(process.env.VITE_BACKEND_PORT || '18000')"') do set BACKEND_PORT=%%a
call npx concurrently --kill-others --names "BACKEND,ELECTRON" --prefix-colors "cyan,magenta" "cd backend && %PYTHON_CMD% app\start_server.py" "npx wait-on --delay 1500 --timeout 60000 http://127.0.0.1:%BACKEND_PORT%/docs >nul 2>&1 && cd electron && npx electron ."

exit /b %ERRORLEVEL%
