@echo off
chcp 65001 >nul
title Precis TUI (Rust)

set "PROJECT_ROOT=%~dp0..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis TUI (Rust + ratatui)
echo ============================================
echo.

:: 后端端口由 OS 动态分配,实际端口写入 backend/.backend-port
:: TUI 通过 PRECIS_BACKEND_URL 环境变量获知后端地址
set "PORT_FILE=%PROJECT_ROOT%\backend\.backend-port"
if not exist "%PORT_FILE%" (
    echo [ERROR] Backend port file not found: %PORT_FILE%
    echo         请先启动后端: start-backend.bat 或 npm run start:backend:win
    pause
    exit /b 1
)
set /p BACKEND_PORT=<"%PORT_FILE%"
echo [OK] Backend port: %BACKEND_PORT%

:: Health check 后端动态端口
echo [CHECK] Backend (port %BACKEND_PORT%)...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%BACKEND_PORT%/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { Write-Host '[OK] Backend is running.' } else { Write-Host '[WARN] Backend responded with status' $r.StatusCode } } catch { Write-Host '[WARN] Backend not detected at port %BACKEND_PORT%.' }"

:: 注入后端地址到环境变量,Rust TUI 的 main.rs 会读取 PRECIS_BACKEND_URL
set "PRECIS_BACKEND_URL=http://127.0.0.1:%BACKEND_PORT%"

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

:: Build: stderr (warnings) goes to log file, only check exit code
"%CARGO%" build 2>build-warnings.log
if errorlevel 1 (
    echo [ERROR] Build failed. See build-warnings.log
    pause
    exit /b 1
)
echo [OK] Build successful.
echo.

:: Run quietly (suppress runtime stderr)
"%CARGO%" run -q 2>nul
set "EXIT_CODE=%ERRORLEVEL%"
echo.

if not "%EXIT_CODE%"=="0" (
    echo [ERROR] TUI exited with code %EXIT_CODE%.
    pause
)
exit /b %EXIT_CODE%
