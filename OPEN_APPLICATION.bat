@echo off
echo ========================================
echo Opening IFRS.ai Application
echo ========================================
echo.
echo Waiting 5 seconds for servers to start...
timeout /t 5 /nobreak >nul
echo.
echo Opening browser...
start http://localhost:3004
echo.
echo ========================================
echo Application URLs:
echo ========================================
echo.
echo Frontend: http://localhost:3004
echo Backend:  http://localhost:9000
echo API Docs: http://localhost:9000/api/docs
echo.
echo If the page doesn't load, wait 10 more seconds
echo and refresh the browser.
echo.
pause
