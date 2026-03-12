@echo off
echo ========================================
echo Clean Install - IFRS.ai Frontend
echo ========================================
echo.

echo Step 1: Stopping all Node processes...
taskkill /F /IM node.exe 2>nul
timeout /t 3 /nobreak >nul
echo Done.
echo.

echo Step 2: Cleaning old files...
cd /d %~dp0\frontend
if exist node_modules (
    echo Deleting node_modules (this may take 30 seconds)...
    rmdir /s /q node_modules 2>nul
    echo Done.
) else (
    echo node_modules already deleted.
)
if exist package-lock.json del package-lock.json
if exist .next rmdir /s /q .next
echo Done.
echo.

echo Step 3: Fresh npm install...
call npm install
echo.

if %ERRORLEVEL% EQU 0 (
    echo ========================================
    echo SUCCESS! Dependencies installed.
    echo ========================================
    echo.
    echo Step 4: Starting server...
    echo.
    call npm run dev
) else (
    echo ========================================
    echo ERROR: npm install failed
    echo ========================================
    echo.
    echo Please check the error messages above.
    echo You may need to update Node.js to v22 LTS.
    echo.
    pause
)
