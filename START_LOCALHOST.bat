@echo off
echo ========================================
echo Starting IFRS AI Platform
echo ========================================
echo.

echo [1/2] Starting Backend (FastAPI)...
start "IFRS Backend" cmd /k "cd /d %~dp0 && python app.py"
timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend (Next.js)...
start "IFRS Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo ========================================
echo Both servers are starting!
echo ========================================
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:3000
echo API Docs: http://localhost:8000/api/docs
echo.
echo Press any key to exit this window...
pause >nul
