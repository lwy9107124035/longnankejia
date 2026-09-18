@echo off
title Stop Heritage Assistant
echo.
echo Stopping Longnan Heritage Assistant services...
echo.

rem stop cloudflared tunnel
taskkill /f /im cloudflared.exe >nul 2>nul
if errorlevel 1 (
    echo [OK] No cloudflared tunnel running
) else (
    echo [OK] Cloudflared tunnel stopped
)

rem stop python http.server on ports 8787-8809
set STOPPED=0
for %%p in (8787 8788 8789 8790 8791 8792 8793 8794 8795 8796 8797 8798 8799 8800 8801 8802 8803 8804 8805 8806 8807 8808 8809) do (
    for /f "tokens=5" %%i in ('netstat -ano ^| findstr /c:":%%p " ^| findstr /c:"LISTENING" 2^>nul') do (
        taskkill /f /pid %%i >nul 2>nul
        if not errorlevel 1 set STOPPED=1
    )
)

if %STOPPED%==1 (
    echo [OK] Local HTTP server stopped
) else (
    echo [OK] No local HTTP server found on ports 8787-8809
)

echo.
echo Done. All services stopped.
timeout /t 3 >nul
