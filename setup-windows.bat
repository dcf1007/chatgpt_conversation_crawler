@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ChatGPT Share Archiver - Windows setup

set "NODE_EXE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE (
  echo.
  echo Node.js was not found in PATH.
  echo Install Node.js 20 or newer, reopen this folder, then run this file again.
  pause
  exit /b 1
)

for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
set "NPM_CMD=%NODE_DIR%npm.cmd"

echo Using Node: "%NODE_EXE%"
"%NODE_EXE%" --version

if not exist "%NPM_CMD%" (
  echo.
  echo npm.cmd was not found next to the active Node executable:
  echo   "%NPM_CMD%"
  echo.
  echo Your Node.js installation appears incomplete. Reinstall Node.js with npm included.
  pause
  exit /b 1
)

echo.
echo Using npm: "%NPM_CMD%"
call "%NPM_CMD%" --version
if errorlevel 1 goto :npm_broken

echo.
echo Installing project packages...
call "%NPM_CMD%" install
if errorlevel 1 goto :fail

echo.
echo Installing Playwright Chromium...
if not exist "node_modules\playwright\cli.js" goto :fail
"%NODE_EXE%" "node_modules\playwright\cli.js" install chromium
if errorlevel 1 goto :fail

echo.
echo Setup complete.
echo Run start-windows.bat to launch the archiver.
pause
exit /b 0

:npm_broken
echo.
echo The npm installation paired with your active Node.js is broken.
echo Reinstall Node.js with npm included, then run this setup again.
pause
exit /b 1

:fail
echo.
echo Setup failed. Review the error above.
pause
exit /b 1
