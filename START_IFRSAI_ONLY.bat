@echo off
echo ========================================
echo Starting IFRS AI Platform (frontend port 3004)
echo ========================================
echo.

echo [1/2] Starting Backend (FastAPI), default port 9000...
start "IFRS Backend" cmd /k "cd /d %~dp0 && python app.py"
timeout /t 3 /nobreak >nul

echo [2/2] Starting Frontend (Next.js package.json dev = port 3004)...
start "IFRS Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo ========================================
echo IFRS AI Platform is starting!
echo ========================================
echo.
echo Frontend: http://localhost:3004
echo Backend:  http://localhost:9000
echo API Docs: http://localhost:9000/api/docs
echo.
echo For port 3002 or 3003 use: npm run dev:3002 / dev:localhost in frontend folder.
echo.
echo Press any key to exit this window...
pause >nul
