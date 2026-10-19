@echo off
rem Transmite la pantalla a la tele Valencia. Ctrl+C para detener.
cd /d "%~dp0"
node cast.js --device Valencia %*
pause
