@echo off
rem Precis PyPI Console entry point: delegates to the common launcher.
rem Usage: pypi-gui.bat [--port 17889] [--no-open]
call "%~dp0_gui-launcher.bat" "PyPI" 17889 "scripts\release\pypi-gui.mjs" %*
exit /b %ERRORLEVEL%
