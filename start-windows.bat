@echo off
setlocal
cd /d "%~dp0"

echo Starting ChatGPT Conversation Crawler - beta11-dev diagnostics...
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
if not exist "%~dp0server-dev.mjs" goto :missing_entrypoint
if not exist "%~dp0server.mjs" goto :missing_entrypoint

start "" /b cmd /c "ping 127.0.0.1 -n 3 >nul & start http://localhost:3000"
node "%~dp0server-dev.mjs"
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo The diagnostic server stopped with exit code %EXITCODE%.
  echo If the error mentions a missing package or browser, run setup-windows.bat.
  pause
)
exit /b %EXITCODE%

:missing_entrypoint
echo.
echo server-dev.mjs or server.mjs is missing from this folder.
echo Re-extract the complete beta11-dev archive before starting the crawler.
pause
exit /b 1

:needs_setup
echo.
echo Dependencies are not installed in this folder.
echo Run setup-windows.bat once, then run start-windows.bat again.
pause
exit /b 1
