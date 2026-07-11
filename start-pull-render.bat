@echo off
setlocal
cd /d "%~dp0dashboard"

for /f "usebackq tokens=* delims=" %%U in (`powershell -NoProfile -Command "(Get-Content render-url.txt -Encoding UTF8 | Where-Object { $_ -and $_ -notmatch '^\s*#' } | Select-Object -First 1).Trim()"`) do set RENDER_URL=%%U

if "%RENDER_URL%"=="" (
  echo [ERROR] dashboard\render-url.txt 에 Render URL이 없습니다.
  exit /b 1
)

echo Render pull agent: %RENDER_URL%
set DASHBOARD_PIN=1101
call npm run pull-agent -- --server %RENDER_URL%
pause
