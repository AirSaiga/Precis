@echo off
rem Thin launcher for double-click: delegates to scripts/windows/release-gui.bat.
rem All arguments are forwarded (e.g. release-gui.bat --port 17899 --no-open).
call "%~dp0scripts\windows\release-gui.bat" %*
