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
echo   Phone on the SAME Wi-Fi can open the LAN address above.
echo ============================================
echo.

rem ---- what is this folder actually checked out at? ----
set "BR="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BR=%%b"
set "SHA="
for /f "delims=" %%s in ('git rev-parse --short HEAD 2^>nul') do set "SHA=%%s"
set "WORK=clean"
for /f "delims=" %%d in ('git status --porcelain 2^>nul') do set "WORK=has uncommitted changes"
if defined BR (
    echo   Local preview = files in this folder = branch !BR! @ !SHA! ^(!WORK!^)
    echo   It is NOT necessarily what is online: a branch goes online
    echo   only after it is pushed and deployed.
) else (
    echo   This folder is not a git checkout, so local preview = files on disk.
)
echo.
echo   Online addresses - open them in a browser any time, no launcher needed:
echo     main   https://longnankejia.pages.dev/
echo     qcode  https://qcode.longnankejia-dev.pages.dev/
echo     dev    https://longnankejia-dev.pages.dev/
echo ============================================
echo.
start "" "http://localhost:%PORT%/"
echo   Local preview opened in the browser. This window can be closed.
echo.
set /p "OPEN=Open an online address too? m=main q=qcode d=dev  [Enter=skip] "
if /i "%OPEN%"=="m" start "" "https://longnankejia.pages.dev/"
if /i "%OPEN%"=="q" start "" "https://qcode.longnankejia-dev.pages.dev/"
if /i "%OPEN%"=="d" start "" "https://longnankejia-dev.pages.dev/"
echo.
echo   To stop the local server, run: zhanting.bat
timeout /t 20 /nobreak >nul
exit /b 0
