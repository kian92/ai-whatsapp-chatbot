@echo off

REM Check if Chocolatey is installed
where choco >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Installing Chocolatey...
    @powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))"
    refreshenv
)

REM Install basic requirements
choco install -y git
choco install -y nodejs
choco install -y python3

REM Install Python packages and Node modules
call npm install
pip install -r requirements.txt

REM Set environment variables
set FLASK_ENV=production
set FLASK_APP=dashboard.py

REM Start the Flask application with Gunicorn
python -m gunicorn --bind 0.0.0.0:8080 dashboard:app --pid gunicorn.pid