@echo off
REM Complete startup script for IFRS AI - Starts both backend and frontend
REM This script will start both servers in separate windows

echo ============================================================
echo IFRS AI - COMPLETE STARTUP
echo ============================================================
echo.

REM Optional root .env (e.g. ANTHROPIC_API_KEY for some features) — not required for API + UI
if not exist ".env" (
    echo NOTE: No .env in project root. Create one if you need keys for cloud features.
    echo.
) else (
    findstr /C:"ANTHROPIC_API_KEY=sk-ant-" .env >nul
    if errorlevel 1 (
        echo WARNING: ANTHROPIC_API_KEY in .env may be missing or not sk-ant-*
        echo CFO / RAG features need a key in frontend\.env.local or root .env per docs.
        echo.
    )
)

REM Prefer same-origin /api proxy (empty NEXT_PUBLIC_API_URL) — avoids CORS and matches Next route proxy
if not exist "frontend\.env.local" (
    echo Creating frontend\.env.local...
    (
        echo # IFRS AI local dev: empty NEXT_PUBLIC_API_URL = Next proxies /api to Python
        echo NEXT_PUBLIC_API_URL=
        echo NEXT_PUBLIC_SUPABASE_URL=
        echo NEXT_PUBLIC_SUPABASE_ANON_KEY=
    ) > frontend\.env.local
)

echo.
echo ============================================================
echo Starting Backend Server (Port 9000)...
echo ============================================================
echo.

REM Start backend in new window
start "IFRS AI Backend" cmd /k "cd /d %~dp0 && python app.py"

REM Wait a bit for backend to start
timeout /t 3 /nobreak >nul

echo.
echo ============================================================
echo Starting Frontend Server (Port 3004)...
echo ============================================================
echo.

REM Start frontend in new window
start "IFRS AI Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ============================================================
echo SUCCESS! Both servers are starting...
echo ============================================================
echo.
echo Backend:  http://localhost:9000
echo Frontend: http://localhost:3004
echo.
echo Two new windows opened - one for backend, one for frontend
echo Wait for both to show "Ready" or "running" messages
echo.
echo Press any key to close this window...
pause >nul
