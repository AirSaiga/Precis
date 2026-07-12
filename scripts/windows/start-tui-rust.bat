@echo off
chcp 65001 >nul
title Precis TUI (Rust)

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis TUI (Rust + ratatui)
echo ============================================
echo.

:: Check backend is running on port 18000
echo [CHECK] Backend (port 18000)...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:18000/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { Write-Host '[OK] Backend is running.' } else { Write-Host '[WARN] Backend responded with status' $r.StatusCode } } catch { Write-Host '[WARN] Backend not detected.' }"

:: Locate Rust toolchain
set "CARGO=%USERPROFILE%\.cargo\bin\cargo.exe"
if not exist "%CARGO%" (
    where cargo >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Rust cargo not found. Install from https://rustup.rs/
        pause
        exit /b 1
    )
    set "CARGO=cargo"
)
echo [OK] cargo found.

:: Build and run
cd /d "%PROJECT_ROOT%\tui-rust"
echo [BUILD] Compiling (debug)...
:: 编译输出重定向到日志文件，只检查是否成功（warning 不刷屏）
"%CARGO%" build 2>"%PROJECT_ROOT%\tui-rust\build-warnings.log"
if not "%ERRORLEVEL%"=="0" (
    echo [ERROR] Build failed. See tui-rust\build-warnings.log for details.
    type "%PROJECT_ROOT%\tui-rust\build-warnings.log"
    pause
    exit /b 1
)
echo [OK] Build successful.
echo.
"%CARGO%" run -q 2>nul
set "EXIT_CODE=%ERRORLEVEL%"
echo.

if not "%EXIT_CODE%"=="0" (
    echo [ERROR] TUI exited with code %EXIT_CODE%.
    pause
)
exit /b %EXIT_CODE%
