@echo off
setlocal EnableDelayedExpansion
title Longnan Heritage Assistant
cd /d "%~dp0"

echo ============================================
echo   Longnan Hakka Heritage Digital Assistant
echo   One-key local launcher
echo ============================================
echo.

rem ---- find python ----
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where python3 >nul 2>nul && set "PY=python3"
if not defined PY where py >nul 2>nul && set "PY=py"
if not defined PY (
    echo [ERROR] Python not found.
    echo Install from https://www.python.org/downloads/
    echo and check "Add Python to PATH".
    pause
    exit /b 1
)
echo [OK] Python found: %PY%

rem ---- find free port 8787-8809 ----
set PORT=8787
:PORTLOOP
netstat -ano | findstr /c:":%PORT% " | findstr /c:"LISTENING" >nul 2>nul
if errorlevel 1 goto PORTFREE
set /a PORT+=1
if %PORT% LSS 8810 goto PORTLOOP
echo [WARN] Ports 8787-8809 all busy, using 8787 anyway
set PORT=8787
:PORTFREE
echo [OK] Port: %PORT%

rem ---- start http server (background minimized window) ----
start "heritage-server" /min cmd /c "%PY% -m http.server %PORT% --bind 0.0.0.0"
timeout /t 2 /nobreak >nul

rem ---- detect LAN IPv4 ----
set "LANIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set "RAW=%%a"
    for /f "tokens=* delims= " %%b in ("!RAW!") do set "RAW=%%b"
    if not defined LANIP if not "!RAW!"=="" if not "!RAW!"=="127.0.0.1" set "LANIP=!RAW!"
)

echo.
echo ============================================
echo   Server is running in background
echo ============================================
echo.
echo   Local :  http://localhost:%PORT%/
if defined LANIP (
    echo   LAN   :  http://!LANIP!:%PORT%/
) else (
    echo   LAN   :  check ipconfig for your IPv4
)
echo.
echo   Phone on SAME Wi-Fi can open the LAN address.
echo   For PUBLIC internet access, run: gongwang.bat
echo ============================================
echo.
start "" "http://localhost:%PORT%/"
echo   Browser opened. This window can be closed.
echo   To stop everything, run: zhanting.bat
timeout /t 5 /nobreak >nul
exit /b 0
