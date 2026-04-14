@echo off
REM IFRS 16 Automation Startup Script for Windows

echo ============================================================
echo IFRS 16 LEASE ACCOUNTING AUTOMATION
echo ============================================================
echo.

REM Check if virtual environment exists
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/upgrade dependencies
echo.
echo Installing dependencies...
pip install -r requirements.txt --quiet

REM Check for .env file
if not exist ".env" (
    echo.
    echo WARNING: .env file not found!
    echo Please create a .env file with your ANTHROPIC_API_KEY
    echo Example: copy .env.example .env
    echo.
    pause
)

REM Create directories
if not exist "uploads\" mkdir uploads
if not exist "outputs\" mkdir outputs

REM Start the application
echo.
echo ============================================================
echo Starting IFRS 16 API Server...
echo ============================================================
echo.
echo API Documentation: http://localhost:9000/api/docs
echo ReDoc: http://localhost:9000/api/redoc
echo.
echo Press Ctrl+C to stop the server
echo ============================================================
echo.

python app.py
