@echo off
chcp 65001 >nul
title Precis TUI (Rust)

set "PROJECT_ROOT=%~dp0..\.."
cd /d "%PROJECT_ROOT%"
setlocal enabledelayedexpansion

echo ============================================
echo      Precis TUI (Rust + ratatui)
echo ============================================
echo.

:: Backend port is OS-assigned; the actual port is written to backend/.backend-port
:: Backend healthy -> reuse the running backend via PRECIS_BACKEND_URL
:: Backend absent  -> leave it unset; the TUI spawns its own backend via backend.rs and cleans up on exit
:: NOTE: inside if-blocks, echo text must not contain bare parentheses (cmd parse error); use !VAR! delayed expansion
set "PRECIS_BACKEND_URL="
set "PORT_FILE=%PROJECT_ROOT%\backend\.backend-port"
if exist "%PORT_FILE%" (
    set /p BACKEND_PORT=<"%PORT_FILE%"
    echo [OK] Backend port file: !BACKEND_PORT!
    echo [CHECK] Backend port !BACKEND_PORT! ...
    powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:!BACKEND_PORT!/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
    if not errorlevel 1 (
        echo [OK] Backend is running. Reusing it via PRECIS_BACKEND_URL.
        set "PRECIS_BACKEND_URL=http://127.0.0.1:!BACKEND_PORT!"
    ) else (
        echo [INFO] Backend not detected at port !BACKEND_PORT!. TUI will spawn its own backend.
    )
) else (
    echo [INFO] No backend port file detected. TUI will spawn its own backend.
)

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
