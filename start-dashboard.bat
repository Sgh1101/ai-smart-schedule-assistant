@echo off
setlocal
cd /d "%~dp0dashboard"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js/npm not found.
  echo Install from https://nodejs.org/ then run this script again.
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Starting dashboard server at http://localhost:3000
call npm start
