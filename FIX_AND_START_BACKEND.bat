@echo off
title IFRS AI - Start Backend
cd /d %~dp0

echo.
echo ========================================
echo   IFRS AI - Backend only (FastAPI)
echo ========================================
echo.
echo Default URL: http://127.0.0.1:9000
echo API docs:    http://127.0.0.1:9000/api/docs
echo.
echo If port 9000 is stuck, close the other "python app.py" window first.
echo This script does NOT kill every Python process on your PC.
echo.
echo Starting...
echo.

python app.py

pause
