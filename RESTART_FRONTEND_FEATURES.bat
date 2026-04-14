@echo off
echo ========================================
echo Restarting Frontend to Update Features
echo ========================================
echo.

cd /d %~dp0\frontend

echo [1/3] If port 3004 is busy, close the other Next.js window or run: npm run dev:3000
echo      (This script no longer kills all Node processes — that broke other apps.)
timeout /t 1 /nobreak >nul

echo [2/3] Clearing Next.js cache...
if exist .next (
    rmdir /s /q .next
    echo Cache cleared.
)

echo [3/3] Starting development server...
echo.
echo ========================================
echo Frontend will be available at:
echo http://localhost:3004
echo ========================================
echo.
echo Press Ctrl+C to stop the server
echo.

call npm run dev

pause
