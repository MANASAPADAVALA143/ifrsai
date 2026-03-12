@echo off
echo ========================================
echo Starting IFRS AI Platform (Port 3002)
echo ========================================
echo.

echo Stopping any existing IFRS processes...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq IFRS*" 2>nul
taskkill /F /IM python.exe /FI "WINDOWTITLE eq IFRS*" 2>nul
timeout /t 2 /nobreak >nul

echo [1/2] Starting Backend (FastAPI) on port 8000...
start "IFRS Backend - Port 8000" cmd /k "cd /d %~dp0 && python app.py"
timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend (Next.js) on port 3002...
start "IFRS Frontend - Port 3002" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo ========================================
echo IFRS AI Platform is starting!
echo ========================================
echo.
echo Frontend: http://localhost:3002
echo Backend:  http://localhost:8000
echo API Docs: http://localhost:8000/api/docs
echo.
echo NOTE: Port 3000 is used by Real Estate app
echo       IFRS.ai is running on port 3002
echo.
echo Press any key to exit this window...
pause >nul
