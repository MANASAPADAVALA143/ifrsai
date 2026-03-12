@echo off
title IFRS AI - Launcher
cd /d "%~dp0"

echo.
echo ========================================
echo   IFRS AI - One-Click Start
echo ========================================
echo.

REM Free port 9000 (backend)
echo Freeing port 9000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :9000 ^| findstr LISTENING 2^>nul') do (
  taskkill /F /PID %%a 2>nul
  echo   Killed process on 9000
)

REM Free port 3004 (frontend)
echo Freeing port 3004...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3004 ^| findstr LISTENING 2^>nul') do (
  taskkill /F /PID %%a 2>nul
  echo   Killed process on 3004
)

REM Kill stuck Node (frontend lock)
taskkill /F /IM node.exe 2>nul
REM Remove Next.js dev lock so npm run dev doesn't fail
if exist "frontend\.next\dev\lock" del /f "frontend\.next\dev\lock" 2>nul

echo.
echo Waiting 3 seconds...
timeout /t 3 /nobreak >nul
echo.

REM Start Backend (new window)
echo [1/2] Starting Backend on port 9000...
start "IFRS AI Backend (9000)" cmd /k "cd /d "%~dp0" && python app.py"

echo Waiting for backend (10 seconds)...
timeout /t 10 /nobreak >nul

REM Start Frontend (new window)
echo [2/2] Starting Frontend on port 3004...
start "IFRS AI Frontend (3004)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo Waiting for frontend (20 seconds)...
timeout /t 20 /nobreak >nul

REM Open browser
echo.
echo Opening app in browser...
start "" "http://localhost:3004"

echo.
echo ========================================
echo   DONE
echo ========================================
echo.
echo   KEEP BOTH BLACK WINDOWS OPEN.
echo   Backend  = port 9000
echo   Frontend = port 3004
echo.
echo   App URL: http://localhost:3004
echo.
pause
