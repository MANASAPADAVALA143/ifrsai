@echo off
echo ========================================
echo Starting IFRS.ai Frontend
echo ========================================
echo.
echo Navigating to frontend directory...
cd /d %~dp0\frontend
echo.
echo Current directory: %CD%
echo.
echo Starting Next.js on port 3002...
echo.
npm run dev
pause
