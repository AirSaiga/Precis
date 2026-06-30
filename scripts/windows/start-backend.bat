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
for /f "tokens=*" %%a in ('node -e "try { require('dotenv').config(); } catch(e) {} console.log(process.env.VITE_BACKEND_PORT || '18000')"') do set BACKEND_PORT=%%a

:: 启动前清理端口残留进程，避免 [Errno 10048] 端口占用
call "%~dp0\free-port.bat" %BACKEND_PORT%

"%PYTHON_CMD%" -m uvicorn app.api.main:app --reload --port %BACKEND_PORT%

echo.
echo [INFO] Backend stopped.
pause >nul
exit /b %ERRORLEVEL%
