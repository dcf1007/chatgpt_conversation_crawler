@echo off
setlocal
cd /d "%~dp0"

echo Starting ChatGPT Share Archiver...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Run setup-windows.bat after installing Node.js 20 or newer.
  pause
  exit /b 1
)

if not exist "node_modules\playwright" (
  echo Dependencies are not installed. Run setup-windows.bat first.
  pause
  exit /b 1
)

start "" cmd /c "ping 127.0.0.1 -n 3 >nul & start http://localhost:3000"
call npm start
