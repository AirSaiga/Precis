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

call python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python ^(3.13+^).
    pause
    exit /b 1
)
for /f "tokens=2" %%a in ('python --version') do echo [OK] Python: %%a
echo.

cd backend
python -m uvicorn app.api.main:app --reload --port 18000

echo.
echo [INFO] Backend stopped.
pause >nul
exit /b %ERRORLEVEL%
