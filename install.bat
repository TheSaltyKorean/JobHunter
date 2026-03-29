@echo off
REM If running from PowerShell, re-launch in cmd.exe to avoid Pester conflicts
if defined PSModulePath (
    cmd /c "%~f0" %*
    exit /b
)
echo ============================================
echo   JobApplicationBot - First-Time Setup
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found.
    echo Please install Python 3.10+ from https://python.org
    pause
    exit /b 1
)
echo [OK] Python found

:: Install pip dependencies
echo.
echo Installing Python dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed. Try running as Administrator.
    pause
    exit /b 1
)
echo [OK] Dependencies installed

:: Install Playwright browsers
echo.
echo Installing Playwright browsers (Chromium)...
echo This downloads ~150MB - please wait...
playwright install chromium
if errorlevel 1 (
    echo WARNING: Playwright install may have had issues.
    echo Try running manually: playwright install chromium
)
echo [OK] Playwright ready

:: Copy resumes
echo.
echo ============================================
echo IMPORTANT: Copy your resume PDFs to the
echo 'resumes' folder with these exact names:
echo.
echo   resumes\2025 Randy Walker - IT Executive.pdf
echo   resumes\2025 Randy Walker - Tech Leader.pdf
echo   resumes\2025 Randy Walker - Cloud.pdf
echo   resumes\2025 Randy Walker - Cloud Contract.pdf
echo ============================================

:: Create required directories
mkdir resumes 2>nul
mkdir data 2>nul
mkdir logs 2>nul

echo.
echo ============================================
echo Setup complete!
echo.
echo Next steps:
echo 1. Copy your 4 PDF resumes to the 'resumes' folder
echo 2. Run 'start.bat' to start the app
echo 3. Open Settings and configure your email + LinkedIn cookie
echo ============================================
pause
