@echo off
rem Precis Release Console entry point: delegates to the common launcher.
rem Usage: release-gui.bat [--port 17888] [--no-open]
call "%~dp0_gui-launcher.bat" "Release" 17888 "scripts\release\release-gui.mjs" %*
exit /b %ERRORLEVEL%
