@echo off
echo Запуск lpbot GUI...
cd /d "%~dp0.."
npx electron gui/gui.js
pause