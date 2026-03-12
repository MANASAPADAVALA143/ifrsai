@echo off
title IFRS AI - Fix and Start Backend
cd /d "%~dp0"

echo.
echo ========================================
echo   Killing processes on port 8000...
echo ========================================
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
  taskkill /F /PID %%a 2>nul
  echo   Killed PID %%a
)

echo.
echo Killing any Python processes...
taskkill /F /IM python.exe 2>nul
taskkill /F /IM python3.exe 2>nul
echo.

timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo   Starting Backend...
echo ========================================
echo.
python app.py

pause
