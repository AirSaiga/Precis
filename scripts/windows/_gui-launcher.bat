@echo off
rem ============================================================
rem  Precis GUI console common launcher (do NOT run directly).
rem  Usage: _gui-launcher.bat <name> <default-port> <script-rel-path> [user args...]
rem  Example: _gui-launcher.bat "Release" 17888 "scripts\release\release-gui.mjs" --no-open
rem  Note: keep this file pure ASCII. chcp 65001 only affects console
rem  output (so the node script's Chinese logs render correctly);
rem  cmd still parses this file with the system codepage (GBK).
rem ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion

set "CONSOLE_NAME=%~1"
set "DEFAULT_PORT=%~2"
set "SCRIPT_REL=%~3"

rem Collect the 4th and later args, forward them verbatim to the node script.
set "USER_ARGS="
:collect_args
if "%~4"=="" goto args_done
set "USER_ARGS=!USER_ARGS! "%~4""
shift
goto collect_args
:args_done

title Precis - %CONSOLE_NAME% Console

set "PROJECT_ROOT=%~dp0\..\.."
cd /d "%PROJECT_ROOT%"

echo ============================================
echo      Precis %CONSOLE_NAME% Console (GUI)
echo ============================================
echo.

rem --- 1. Node.js existence check ---
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js ^(^>=20.19.0 or ^>=22.12.0^).
    pause
    exit /b 1
)
for /f "tokens=*" %%a in ('node --version') do set "NODE_VER=%%a"
for /f "tokens=1,2 delims=v." %%a in ("%NODE_VER%") do (
    set "NODE_MAJOR=%%a"
    set "NODE_MINOR=%%b"
)

rem --- 2. Node.js version check: ^>=20.19.0 or ^>=22.12.0 ---
set "NODE_OK=1"
if !NODE_MAJOR! LSS 20 set "NODE_OK=0"
if !NODE_MAJOR! EQU 20 if !NODE_MINOR! LSS 19 set "NODE_OK=0"
if !NODE_MAJOR! EQU 21 set "NODE_OK=0"
if !NODE_MAJOR! EQU 22 if !NODE_MINOR! LSS 12 set "NODE_OK=0"
if "!NODE_OK!"=="0" (
    echo [ERROR] Node.js %NODE_VER% is too old. Required: ^>=20.19.0 or ^>=22.12.0.
    pause
    exit /b 1
)
echo [OK] Node.js: %NODE_VER%

rem --- 3. Console script existence check ---
if not exist "%SCRIPT_REL%" (
    echo [ERROR] Console script not found: %SCRIPT_REL%
    echo         Make sure this .bat lives in the project's scripts\windows directory.
    pause
    exit /b 1
)

echo.
echo [INFO] Starting %CONSOLE_NAME% console...
echo   - Default URL: http://127.0.0.1:%DEFAULT_PORT% ^(auto-increments if busy^)
echo   - Options: --port ^<port^>  ^|  --no-open ^(skip opening the browser^)
echo   - The actual listening address is printed by the script below
echo   - Keep this window open while using the console; close it or press Ctrl+C to stop
echo.

call node "%SCRIPT_REL%" !USER_ARGS!
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if !EXIT_CODE! NEQ 0 (
    echo [ERROR] %CONSOLE_NAME% console exited with error code !EXIT_CODE!.
) else (
    echo [INFO] %CONSOLE_NAME% console stopped.
)
pause
exit /b !EXIT_CODE!
