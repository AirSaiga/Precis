@echo off
chcp 65001 >nul
title Precis - Backend (Dev)
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis - Backend (Dev)
echo ============================================
echo.

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
    echo [WARN] No venv found at backend\.venv, falling back to system Python.
)
for /f "tokens=*" %%a in ('"%PYTHON_CMD%" --version') do echo [OK] %%a
echo.

cd backend

:: 后端走统一启动脚本 start_server.py,端口由 OS 动态分配(--port 0),
:: 实际端口写入 backend/.backend-port 供 Vite 代理 / Electron 发现。
:: 动态端口永不冲突,无需 free-port 预清理。
"%PYTHON_CMD%" app/start_server.py --reload

echo.
echo [INFO] Backend stopped.
pause >nul
exit /b %ERRORLEVEL%
