@echo off
echo ========================================
echo Node.js Version Fix & Server Start
echo ========================================
echo.

echo Current Node.js version:
node --version
echo.

echo IMPORTANT: If you see v20.18.0 or lower:
echo 1. Go to https://nodejs.org/
echo 2. Download Node.js v22 LTS
echo 3. Install it
echo 4. Restart your computer
echo 5. Run this script again
echo.

pause

echo.
echo Cleaning old dependencies...
cd /d %~dp0\frontend
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del package-lock.json

echo.
echo Installing fresh dependencies...
call npm install

echo.
echo Starting server...
echo.
echo Once you see "Ready", open: http://localhost:3004
echo.
call npm run dev

pause
