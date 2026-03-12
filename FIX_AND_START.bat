@echo off
echo ========================================
echo IFRS AI - Complete Fix and Start
echo ========================================
echo.

cd /d %~dp0\frontend

echo [1/4] Checking Node.js...
node --version
if errorlevel 1 (
    echo ERROR: Node.js not found! Please install Node.js first.
    pause
    exit /b 1
)
echo.

echo [2/4] Installing/Updating dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed!
    pause
    exit /b 1
)
echo.

echo [3/4] Clearing cache...
if exist .next (
    rmdir /s /q .next
    echo Cache cleared.
)
echo.

echo [4/4] Starting development server...
echo.
echo ========================================
echo Server starting on http://localhost:3003
echo ========================================
echo.
echo Keep this window open while working.
echo Press Ctrl+C to stop the server.
echo.

call npm run dev

pause
