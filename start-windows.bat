@echo off
setlocal
cd /d "%~dp0"

echo Starting ChatGPT Share Archiver...
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js was not found in PATH.
  echo Install Node.js 20 or newer, then run setup-windows.bat.
  pause
  exit /b 1
)

if not exist "node_modules\playwright\package.json" goto :needs_setup
if not exist "node_modules\express\package.json" goto :needs_setup

rem Do NOT run npm here. Starting the server directly avoids accidental
rem resolution of a broken project-local npm.cmd/npm package on Windows.
start "" /b cmd /c "ping 127.0.0.1 -n 3 >nul & start http://localhost:3000"
node "%~dp0server.mjs"
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo The server stopped with exit code %EXITCODE%.
  echo If the error mentions a missing package or browser, run setup-windows.bat.
  pause
)
exit /b %EXITCODE%

:needs_setup
echo.
echo Dependencies are not installed in this folder.
echo Run setup-windows.bat once, then run start-windows.bat again.
pause
exit /b 1
