@echo off
title Start Station ERP
setlocal EnableExtensions

rem ============================================================
rem  Start Station ERP for the end user (double-click this file)
rem  Starts the ERP backend + web app and opens the browser.
rem  Close the "ERP Backend" window to stop the application.
rem ============================================================

rem --- locate the backend folder (same folder as this script) ---
set "BACK=%~dp0erp-backend"

rem --- check Node.js is installed ---
node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Please install Node.js from https://nodejs.org and try again.
  pause
  exit /b 1
)

rem --- check dependencies are installed ---
if not exist "%BACK%\node_modules" (
  echo Missing dependencies.
  echo Open a terminal, run:  npm install   inside the erp-backend folder, then try again.
  pause
  exit /b 1
)

if not exist "%BACK%\src\server.js" (
  echo Could not find %BACK%\src\server.js
  pause
  exit /b 1
)

cd /d "%BACK%"

rem --- stop any previous ERP / dev-server instances to avoid conflicts ---
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":4000 .*LISTENING" 2^>nul') do (
  taskkill /f /pid %%P >nul 2>&1
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5173 .*LISTENING" 2^>nul') do (
  taskkill /f /pid %%P >nul 2>&1
)

rem --- start the ERP backend (serves the API and the web app) ---
start "ERP Backend" /min cmd /q /c "node src/server.js"

rem --- wait for the server to come up (max ~10 seconds) ---
set /a tries=0
:waitloop
set /a tries+=1
if %tries% gtr 10 goto readywarn
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:4000/api/health' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto waitloop
)

:readywarn

rem --- open the application in the default browser ---
start "" http://localhost:4000
echo.
echo ERP is starting... browser will open at http://localhost:4000
echo To stop the application, close the "ERP Backend" (minimized) window.
timeout /t 2 /nobreak >nul
endlocal