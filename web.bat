@echo off
rem Sirve la pantalla para abrirla en el navegador de la tele. Ctrl+C para detener.
cd /d "%~dp0"
node web.js %*
pause
