@echo off
title IFRS AI - Launcher
cd /d "%~dp0"

echo.
echo ========================================
echo   IFRS AI - Starting Backend + Frontend
echo ========================================
echo.

REM Start Backend (new window - keep it open)
echo [1/2] Opening Backend window...
start "IFRS AI Backend" cmd /k "cd /d "%~dp0" && echo Starting backend... && python app.py"

REM Wait for backend to start
echo Waiting for backend (8 seconds)...
timeout /t 8 /nobreak >nul

REM Start Frontend (new window - keep it open)
echo [2/2] Opening Frontend window...
start "IFRS AI Frontend" cmd /k "cd /d "%~dp0frontend" && echo Starting frontend... && npm run dev:localhost"

REM Wait for frontend to compile
echo Waiting for frontend (15 seconds)...
timeout /t 15 /nobreak >nul

REM Open browser automatically
echo.
echo Opening browser...
start "" "http://localhost:3003"

echo.
echo ========================================
echo   DONE
echo ========================================
echo.
echo   Two CMD windows opened - KEEP BOTH OPEN.
echo   If you close the BACKEND window, the app will show "Backend Offline".
echo.
echo   Backend  = first window (python app.py, port 9000)
echo   Frontend = second window (Next.js, port 3003)
echo.
echo   Your browser should open to the app.
echo   If not, go to: http://localhost:3003
echo.
pause
