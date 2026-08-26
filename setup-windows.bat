@echo off
setlocal
cd /d "%~dp0"

echo ChatGPT Share Archiver - Windows setup
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js was not found in PATH.
  echo Install Node.js 20 or newer, reopen this folder, then run this file again.
  pause
  exit /b 1
)

echo.
echo Installing npm packages...
call npm install
if errorlevel 1 goto :fail

echo.
echo Installing Playwright Chromium...
call npx playwright install chromium
if errorlevel 1 goto :fail

echo.
echo Setup complete.
echo Run start-windows.bat to launch the archiver.
pause
exit /b 0

:fail
echo.
echo Setup failed. Review the error above.
pause
exit /b 1
