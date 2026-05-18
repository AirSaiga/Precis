@echo off
chcp 65001 >nul
title Precis
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

:: Ensure frontend build exists
if not exist "frontend\dist\index.html" (
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
call npx concurrently --kill-others --names "BACKEND,ELECTRON" --prefix-colors "cyan,magenta" "cd backend && python start_server.py" "npx wait-on --delay 1500 --timeout 60000 http://127.0.0.1:18000/docs >nul 2>&1 && cd electron && npx electron ."

exit /b %ERRORLEVEL%
