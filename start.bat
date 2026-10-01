@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 18+ from https://nodejs.org
  echo or run from this folder: python -m http.server 5173  and open http://127.0.0.1:5173/
  pause
  exit /b 1
)
node tools\serve.mjs %*
pause
