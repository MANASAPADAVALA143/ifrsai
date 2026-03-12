@echo off
title IFRS AI - Keep this window open
cd /d "%~dp0"

echo.
echo ========================================
echo   IFRS AI - Starting
echo ========================================
echo   You will see TWO windows. KEEP BOTH OPEN.
echo   Window 1 = Backend (python, port 9000)
echo   Window 2 = Frontend (this one, port 3004)
echo ========================================
echo.

REM Free port 9000 if something is already using it (e.g. old backend)
echo Freeing port 9000 if in use...
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 9000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"
timeout /t 3 /nobreak >nul

REM Start backend in its own window (must stay open - do not close it)
echo [1/2] Opening Backend window (keep it open)...
start "IFRS AI Backend - keep this open" cmd /k "cd /d ""%~dp0"" && python app.py"

REM Wait for backend to bind
echo Waiting for backend (10 sec)...
timeout /t 10 /nobreak >nul

REM Frontend in this window (3004 - use if 3003 is taken by another app)
echo [2/2] Starting frontend...
cd /d "%~dp0frontend"
echo.
echo App URL: http://localhost:3004
echo Opening browser...
start "" "http://localhost:3004"
echo.
npm run dev
