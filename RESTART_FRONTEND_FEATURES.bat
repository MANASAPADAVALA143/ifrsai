@echo off
echo ========================================
echo Restarting Frontend to Update Features
echo ========================================
echo.

cd /d %~dp0\frontend

echo [1/3] Stopping existing Node processes...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2/3] Clearing Next.js cache...
if exist .next (
    rmdir /s /q .next
    echo Cache cleared.
)

echo [3/3] Starting development server...
echo.
echo ========================================
echo Frontend will be available at:
echo http://localhost:3003
echo ========================================
echo.
echo Press Ctrl+C to stop the server
echo.

call npm run dev

pause
