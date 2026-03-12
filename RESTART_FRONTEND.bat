@echo off
echo ========================================
echo Restarting IFRS.ai Frontend
echo ========================================
echo.

echo Stopping existing frontend processes...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq IFRS Frontend*" 2>nul
timeout /t 2 /nobreak >nul

echo Clearing Next.js cache...
cd /d %~dp0\frontend
if exist .next rmdir /s /q .next

echo Starting frontend on port 3002...
start "IFRS Frontend" cmd /k "cd /d %~dp0\frontend && echo === IFRS.ai Frontend === && echo Starting on http://localhost:3002 && echo. && npm run dev"

echo.
echo ========================================
echo Frontend is restarting!
echo ========================================
echo.
echo Wait 10-15 seconds, then open:
echo http://localhost:3002
echo.
echo Press any key to exit...
pause >nul
