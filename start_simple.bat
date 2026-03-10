@echo off
echo ==========================================
echo  3D Earth Platform
echo ==========================================
echo.

cd /d "%~dp0"

echo [1/2] Starting Tile Server...
start cmd /k "cd map && python server.py"

timeout /t 2 > nul

echo [2/2] Starting Web Server...
start cmd /k "cd frontend && python -m http.server 9000"

timeout /t 2 > nul

echo.
echo Opening browser (URL from config.json)...
for /f "delims=" %%i in ('python get_config_url.py api_server 2^>nul') do set "API_URL=%%i"
if not defined API_URL set "API_URL=http://127.0.0.1:9000"
start "" "%API_URL%"

for /f "delims=" %%i in ('python get_config_url.py tile_server 2^>nul') do set "TILE_URL=%%i"
if not defined TILE_URL set "TILE_URL=http://127.0.0.1:9001"

echo.
echo ==========================================
echo Done! Services running at (from config.json):
echo   %API_URL% (Web)
echo   %TILE_URL% (Tiles)
echo ==========================================
pause
