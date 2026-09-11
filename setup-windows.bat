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

rem Do not query the quoted Node executable through FOR /F command substitution.
rem FOR /F reparses its command through cmd.exe and can strip the command quotes
rem from paths such as C:\Program Files\nodejs\node.exe. Run Node directly and
rem read the result from a temporary file instead.
set "NODE_MAJOR_FILE=%TEMP%\chatgpt-share-archiver-node-major-%RANDOM%-%RANDOM%.txt"
"%NODE_EXE%" -p "Number(process.versions.node.split('.')[0])" > "%NODE_MAJOR_FILE%" 2>nul
if errorlevel 1 (
  del /q "%NODE_MAJOR_FILE%" >nul 2>&1
  echo.
  echo Could not determine the active Node.js version.
  pause
  exit /b 1
)
set "NODE_MAJOR="
set /p "NODE_MAJOR="<"%NODE_MAJOR_FILE%"
del /q "%NODE_MAJOR_FILE%" >nul 2>&1

if not defined NODE_MAJOR (
  echo.
  echo Could not determine the active Node.js version.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 20 (
  echo.
  echo Node.js 20 or newer is required. Found:
  "%NODE_EXE%" --version
  pause
  exit /b 1
)

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
