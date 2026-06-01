@echo off
chcp 65001 >nul
title Precis - Frontend (Dev)
setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis - Frontend (Dev)
echo ============================================
echo.

call node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js ^(^>=20.19.0 ^|^| ^>=22.12.0^).
    pause
    exit /b 1
)
for /f "tokens=*" %%a in ('node --version') do echo [OK] Node.js: %%a

if not exist "frontend\node_modules" (
    echo [WARN] frontend\node_modules missing. Run scripts\setup.ps1 or "npm run install:all" first.
    pause
    exit /b 1
)
echo.

cd frontend
npm run dev

echo.
echo [INFO] Frontend stopped.
pause >nul
exit /b %ERRORLEVEL%
