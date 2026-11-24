
# Run and deploy your app

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:**  Node.js


## Install dependencies:

@echo off
setlocal
title Run App
rem ============================================================
rem  Put this file in the SAME folder as package.json / index.html
rem  Double-click to run. Close this window to stop the app.
rem ============================================================
cd /d "%~dp0"
set PORT=8000

rem ---- Case 1: Node project (package.json, Vite/React) ----
if exist package.json (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Node.js not found. Install the LTS version from https://nodejs.org and run again.
    pause & exit /b 1
  )
  if not exist node_modules\.bin (
    echo Installing packages, please wait... first time only
    call npm install --legacy-peer-deps
    if errorlevel 1 (
      echo.
      echo npm install failed. Please send a screenshot of the error.
      pause & exit /b 1
    )
  )
  echo Starting app at http://localhost:3000/
  start "" cmd /c "timeout /t 5 >nul & start "" http://localhost:3000/"
  findstr /c:"\"dev\"" package.json >nul && ( call npm run dev & goto :end )
  findstr /c:"\"start\"" package.json >nul && ( call npm start & goto :end )
)

rem ---- Case 2: Plain HTML/JS app (needs a local web server, not file://) ----
if not exist index.html (
  echo index.html not found in this folder:
  echo %CD%
  echo Move this .bat file next to index.html and try again.
  pause & exit /b 1
)

echo Starting app at http://localhost:%PORT%/
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:%PORT%/"

where python >nul 2>nul
if not errorlevel 1 ( python -m http.server %PORT% & goto :end )
where py >nul 2>nul
if not errorlevel 1 ( py -m http.server %PORT% & goto :end )
where npx >nul 2>nul
if not errorlevel 1 ( npx --yes http-server -p %PORT% -c-1 & goto :end )

echo Neither Python nor Node.js is installed.
echo Install Python from https://www.python.org/downloads/  (tick "Add Python to PATH")
pause

:end
pause
endlocal
