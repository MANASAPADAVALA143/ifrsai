@echo off
REM Complete startup script for IFRS AI - Starts both backend and frontend
REM This script will start both servers in separate windows

echo ============================================================
echo IFRS AI - COMPLETE STARTUP
echo ============================================================
echo.

REM Check if .env file exists and has API key
if not exist ".env" (
    echo ERROR: .env file not found!
    echo Please create .env file with your ANTHROPIC_API_KEY
    echo.
    pause
    exit /b 1
)

findstr /C:"ANTHROPIC_API_KEY=sk-ant-" .env >nul
if errorlevel 1 (
    echo WARNING: API key in .env may not be set correctly
    echo Please check that ANTHROPIC_API_KEY starts with "sk-ant-"
    echo.
)

REM Check if frontend .env.local exists
if not exist "frontend\.env.local" (
    echo Creating frontend\.env.local...
    (
        echo # IFRS AI Frontend Environment Variables
        echo NEXT_PUBLIC_API_URL=http://localhost:8000
        echo NEXT_PUBLIC_SUPABASE_URL=
        echo NEXT_PUBLIC_SUPABASE_ANON_KEY=
    ) > frontend\.env.local
)

echo.
echo ============================================================
echo Starting Backend Server (Port 8000)...
echo ============================================================
echo.

REM Kill any existing processes on port 8000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM Start backend in new window
start "IFRS AI Backend" cmd /k "cd /d %~dp0 && python app.py"

REM Wait a bit for backend to start
timeout /t 3 /nobreak >nul

echo.
echo ============================================================
echo Starting Frontend Server (Port 3003)...
echo ============================================================
echo.

REM Kill any existing processes on port 3003
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3003 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

REM Start frontend in new window
start "IFRS AI Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ============================================================
echo SUCCESS! Both servers are starting...
echo ============================================================
echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:3003
echo.
echo Two new windows opened - one for backend, one for frontend
echo Wait for both to show "Ready" or "running" messages
echo.
echo Press any key to close this window...
pause >nul
