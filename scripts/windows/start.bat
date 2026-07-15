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

:: Start Electron (backend is managed by Electron itself, port dynamically allocated)
:: 生产/标准模式:有前端构建产物时,Electron 自行 spawn 后端并通过端口文件协议发现端口。
:: 无需外部启动后端,也无需 wait-on 固定端口。
cd electron && npx electron .

exit /b %ERRORLEVEL%
