@echo off
title IFRS AI - Localhost
cd /d "%~dp0"
REM UTF-8 so Python log lines with symbols do not crash on some Windows consoles
chcp 65001 >nul 2>&1

echo ========================================
echo   IFRS AI Platform - Localhost
echo ========================================
echo.

REM Same-origin /api/* in the browser; Next.js proxies to Python (see frontend/app/api)
if not exist "frontend\.env.local" (
  echo Creating frontend\.env.local ^(empty NEXT_PUBLIC_API_URL = use /api proxy^)...
  (
    echo # Local dev: leave empty so the UI calls /api/* and Next proxies to Python
    echo NEXT_PUBLIC_API_URL=
  ) > frontend\.env.local
)

echo [1/2] Starting Backend ^(FastAPI^)...
start "IFRS Backend" cmd /k "cd /d %~dp0 && python app.py"

echo Waiting for backend to bind and write api_dev_port.txt ^(6 sec^)...
timeout /t 6 /nobreak >nul

set APIPORT=9000
if exist "%~dp0api_dev_port.txt" set /p APIPORT=<"%~dp0api_dev_port.txt"

echo [2/2] Starting Frontend ^(Next.js, port 3004^)...
start "IFRS Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo.
echo Waiting until Next.js answers on 127.0.0.1:3004 ^(first run can take 1-2 minutes^)...
set /a _FRONT_WAIT=0
:waitfrontend
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3004/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel%==0 goto frontendready
set /a _FRONT_WAIT+=1
if %_FRONT_WAIT% geq 90 goto frontendtimeout
timeout /t 2 /nobreak >nul
goto waitfrontend

:frontendready
echo Frontend is ready — opening browser...
start "" "http://127.0.0.1:3004"
goto urls

:frontendtimeout
echo.
echo Port 3004 did not respond in time. Check the IFRS Frontend window for errors.
echo When it shows Ready, open: http://127.0.0.1:3004
goto urls

:urls
echo.
echo ========================================
echo   KEEP BOTH WINDOWS OPEN ^(Backend + Frontend^)
echo ========================================
echo.
echo   Main app:
echo     http://127.0.0.1:3004
echo.
echo   Backend API ^(default 9000; may differ if port was busy^):
echo     http://127.0.0.1:%APIPORT%
echo   API docs:
echo     http://127.0.0.1:%APIPORT%/api/docs
echo   Health:
echo     http://127.0.0.1:%APIPORT%/health
echo.
echo   If the browser was blank or showed a Chrome error page, the dev server was
echo   not ready yet — wait for Ready in the Frontend window, then refresh.
echo   New Lease: http://127.0.0.1:3004/dashboard/ifrs16/leases/new
echo.
pause
