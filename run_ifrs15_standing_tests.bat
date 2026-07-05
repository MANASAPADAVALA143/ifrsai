@echo off
cd /d "%~dp0.."
python scripts\run_ifrs15_standing_tests.py
exit /b %ERRORLEVEL%
