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
start "IFRS AI Backend" cmd /k "cd /d %~dp0 && echo Starting backend... && python app.py"

REM Create frontend .env.local if missing (empty NEXT_PUBLIC_API_URL = same-origin /api proxy)
if not exist "frontend\.env.local" (
  (
    echo # Local dev: leave empty so the UI calls /api/* and Next proxies to Python
    echo NEXT_PUBLIC_API_URL=
  ) > frontend\.env.local
)

REM Wait for backend to bind and write api_dev_port.txt
echo Waiting for backend (6 seconds)...
timeout /t 6 /nobreak >nul

REM Start Frontend (new window - keep it open) — must match frontend/package.json "dev" (port 3004)
echo [2/2] Opening Frontend window...
start "IFRS AI Frontend" cmd /k "cd /d %~dp0frontend && echo Starting frontend... && npm run dev:webpack"

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
echo Opening browser...
start "" "http://127.0.0.1:3004"
goto doneboth

:frontendtimeout
echo.
echo Port 3004 did not respond in time. When the Frontend window shows Ready, open:
echo   http://127.0.0.1:3004

:doneboth
echo.
echo ========================================
echo   DONE
echo ========================================
echo.
echo   Two CMD windows opened - KEEP BOTH OPEN.
echo   If you close the BACKEND window, the app will show "API offline".
echo.
echo   Backend  = first window (python app.py, default port 9000)
echo   Frontend = second window (Next.js, port 3004)
echo.
echo   App URL: http://127.0.0.1:3004
echo   If you saw a blank page or chrome-error, wait for Ready then refresh.
echo.
pause
