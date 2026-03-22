@echo off
cd /d "%~dp0"
set PYTHON_CMD=
python --version >nul 2>&1 && set PYTHON_CMD=python
if not defined PYTHON_CMD py -3 --version >nul 2>&1 && set PYTHON_CMD=py -3
if not defined PYTHON_CMD (
    echo 未找到 Python，请先安装 Python 3。
    pause
    exit /b 1
)
"%PYTHON_CMD%" launcher.py
if errorlevel 1 pause
