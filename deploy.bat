@echo off
setlocal
title Package Site for Deployment
cd /d "%~dp0"

echo ============================================
echo   Package the site for permanent hosting
echo ============================================
echo.

rem ---- check required files ----
set MISSING=0
for %%f in (index.html css\style.css js\config.js js\knowledge-base.js js\answer-engine.js js\ui.js js\app.js) do (
    if not exist "%%f" (
        echo [MISSING] %%f
        set MISSING=1
    )
)
if %MISSING%==1 (
    echo.
    echo [ERROR] Some files missing. Keep this folder intact.
    pause
    exit /b 1
)
echo [OK] All site files present.

rem ---- resolve real Desktop ----
for /f "delims=" %%d in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"') do set "DESKTOP=%%d"

rem ---- find python ----
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where python3 >nul 2>nul && set "PY=python3"
if not defined PY where py >nul 2>nul && set "PY=py"
if not defined PY (
    echo [ERROR] Python not found.
    pause
    exit /b 1
)

rem ---- build timestamp ----
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "TS=%%i"

rem ---- archive folder ----
set "ARCHIVE=%~dp0部署包"
if not exist "%ARCHIVE%" mkdir "%ARCHIVE%"

rem ---- build zip into archive + desktop ----
set "ZIP_ARC=%ARCHIVE%\v-%TS%.zip"
set "ZIP_DESK=%DESKTOP%\longnan-heritage.zip"
echo.
echo Creating archive: %ZIP_ARC%
echo Creating desktop: %ZIP_DESK%
echo.

"%PY%" -c "import zipfile,pathlib,sys;src=pathlib.Path(r'%~dp0.');files=['index.html','css/style.css','js/config.js','js/knowledge-base.js','js/answer-engine.js','js/ui.js','js/app.js'];paths=[r'%ZIP_ARC%',r'%ZIP_DESK%'];\
[z.unlink() for p in paths for _ in [pathlib.Path(p)] if _.exists()];\
[ (lambda z: ([z.write(src/f,f) for f in files], z.close()))(zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED)) for p in paths ];\
print('Done.')"

if not exist "%ZIP_DESK%" (
    echo [ERROR] Failed to create zip.
    pause
    exit /b 1
)

echo [OK] Archive saved to 部署包\v-%TS%.zip
echo [OK] Desktop copy: longnan-heritage.zip
echo.
echo ============================================
echo   Next steps:
echo ============================================
echo.
echo   1. Open: https://app.netlify.com/drop
echo   2. Drag Desktop\longnan-heritage.zip onto the page
echo   3. Wait for URL, copy it
echo   4. Open assistant page, click QR, paste URL, Save
echo.
echo   All past zips are kept in 部署包\ folder.
echo   To update: change files, re-run this bat,
echo   drag the NEW desktop zip onto Netlify.
echo ============================================
echo.

start "" "https://app.netlify.com/drop"
explorer /select,"%ZIP_DESK%"

echo Press any key to close...
pause >nul
exit /b 0
