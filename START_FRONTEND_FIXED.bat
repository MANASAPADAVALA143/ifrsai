@echo off
echo ========================================
echo Starting IFRS AI Frontend (Fixed)
echo ========================================
echo.

cd /d %~dp0\frontend

echo Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Clearing Next.js cache...
if exist ".next" (
    rmdir /s /q .next
    echo Cache cleared.
)

echo.
echo Starting development server...
echo Server will be available at: http://localhost:3004
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

call npm run dev

pause
