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

rem ---- build zip with Python (forward-slash paths, Linux-compatible) ----
rem resolve real Desktop (handles OneDrive redirect)
for /f "delims=" %%d in ('powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"') do set "DESKTOP=%%d"
set "ZIP=%DESKTOP%\longnan-heritage.zip"
echo.
echo Creating zip: %ZIP%
echo (this only packs index.html + css + js, not the bat/docx files)
echo.

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where python3 >nul 2>nul && set "PY=python3"
if not defined PY where py >nul 2>nul && set "PY=py"
if not defined PY (
    echo [ERROR] Python not found.
    pause
    exit /b 1
)

"%PY%" -c "import zipfile,pathlib,os;src=pathlib.Path(r'%~dp0.');dst=pathlib.Path(r'%ZIP%');[dst.unlink() for _ in [dst] if dst.exists()];files=['index.html','css/style.css','js/config.js','js/knowledge-base.js','js/answer-engine.js','js/ui.js','js/app.js'];z=zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED);[z.write(src/f,f) for f in files];z.close();print('Zip created:',dst,'(',round(dst.stat().st_size/1024,1),'KB )')"

if not exist "%ZIP%" (
    echo [ERROR] Failed to create zip.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   DONE. Next steps:
echo ============================================
echo.
echo   1. A zip file is now on your Desktop:
echo      longnan-heritage.zip
echo.
echo   2. Open this page in your browser:
echo      https://app.netlify.com/drop
echo.
echo   3. Drag the zip file onto that page.
echo.
echo   4. Wait ~10 seconds, you will get a URL like:
echo      https://xxxx-yyyy-1234.netlify.app
echo.
echo   5. Copy that URL. Open the assistant page,
echo      click QR button, paste URL, click Save.
echo.
echo   That URL is PERMANENT and works worldwide.
echo   To update the site later: re-run this bat,
echo   drag the new zip onto the same Netlify page.
echo ============================================
echo.

rem open browser to Netlify Drop
start "" "https://app.netlify.com/drop"

rem reveal zip on desktop
explorer /select,"%ZIP%"

echo Press any key to close...
pause >nul
exit /b 0
