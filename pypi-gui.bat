@echo off
rem Thin launcher for double-click: delegates to scripts/windows/pypi-gui.bat.
rem All arguments are forwarded (e.g. pypi-gui.bat --port 17890 --no-open).
call "%~dp0scripts\windows\pypi-gui.bat" %*
