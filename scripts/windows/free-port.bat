@echo off
chcp 65001 >nul
:: ============================================================
:: free-port.bat - Kill processes occupying a port (manual cleanup tool)
::
:: Usage: call free-port.bat [port]
::   port defaults to 18000
::
:: Finds LISTENING PIDs on the port via netstat, kills them via taskkill.
:: Silent pass when port is free.
::
:: Note: backend ports are now OS-assigned (start_server.py --port 0); start scripts no
:: longer call this tool. Kept only as a manual diagnostic for leftover processes.
:: ============================================================
setlocal enabledelayedexpansion

set "PORT=%~1"
if "%PORT%"=="" set "PORT=18000"

set "KILLED=0"

:: netstat output: "  TCP    127.0.0.1:18000   ...  LISTENING   12345"
:: Token 5 = PID. Filter LISTENING + :PORT to avoid killing wrong process.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    set "PID=%%P"
    if not "!PID!"=="" if not "!PID!"=="0" (
        taskkill /F /PID !PID! >nul 2>&1
        if !errorlevel! equ 0 (
            echo [Precis] Killed PID !PID! on port %PORT%
            set "KILLED=1"
        )
    )
)

if "!KILLED!"=="0" (
    echo [Precis] Port %PORT% is free
) else (
    :: Brief wait for port to fully release
    timeout /t 1 /nobreak >nul 2>&1
)

endlocal
exit /b 0
