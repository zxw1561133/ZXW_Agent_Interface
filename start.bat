@echo off
rem Bat must be ANSI/GBK if you use Chinese in echo; ASCII avoids encoding issues.
chcp 65001 >nul 2>&1
cd /d "%~dp0"

if "%~1"=="" (
    cmd /k "%~f0" keepopen
    exit /b
)

set "API_URL="
set "TILE_URL="

echo.
echo ==========================================
echo     DA Agent Platform - Start
echo ==========================================
echo.

set "PYTHON_CMD="
python --version >nul 2>&1
if %errorlevel% equ 0 set "PYTHON_CMD=python"
if not defined PYTHON_CMD py -3 --version >nul 2>&1
if not defined PYTHON_CMD if %errorlevel% equ 0 set "PYTHON_CMD=py -3"

if not defined PYTHON_CMD (
    echo [ERROR] Python not found. Install Python 3 and add to PATH.
    echo.
    pause
    exit /b 1
)

set "BASE=%~dp0"
set "MAP_DIR=%BASE%map"
set "BACKEND_DIR=%BASE%backend"

echo [1/3] Starting map service port 9001...
start "MapService" cmd /k "cd /d "%MAP_DIR%" && %PYTHON_CMD% server.py"

timeout /t 2 /nobreak >nul

echo [2/3] Starting API service port 9000...
start "APIService" cmd /k "cd /d "%BACKEND_DIR%" && %PYTHON_CMD% server.py"

timeout /t 2 /nobreak >nul

echo [3/3] Opening browser...
timeout /t 1 /nobreak >nul
if exist "get_config_url.py" (
    for /f "usebackq delims=" %%i in (`"%PYTHON_CMD%" get_config_url.py api_server 2^>nul`) do set "API_URL=%%i"
)
if not defined API_URL set "API_URL=http://127.0.0.1:9000"
call :DoOpen "%API_URL%"

if exist "get_config_url.py" (
    for /f "usebackq delims=" %%i in (`"%PYTHON_CMD%" get_config_url.py tile_server 2^>nul`) do set "TILE_URL=%%i"
)
if not defined TILE_URL set "TILE_URL=http://127.0.0.1:9001"

echo.
echo ==========================================
echo Services started
echo Frontend: %API_URL%
echo API: %API_URL%/api
echo Tiles: %TILE_URL%
echo ==========================================
echo.
echo Press any key to stop all services and close...
pause >nul

taskkill /FI "WINDOWTITLE eq MapService*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq APIService*" /F >nul 2>&1

echo All services stopped.
echo.
pause
exit /b 0

:DoOpen
start "" "%~1"
goto :eof
