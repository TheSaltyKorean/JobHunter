Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  JobApplicationBot - First-Time Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Python (Windows Store alias returns non-zero and "was not found" text)
$pyCheck = python --version 2>&1
if ($LASTEXITCODE -ne 0 -or "$pyCheck" -match "not found|not recognized") {
    Write-Host "Python not found. Installing automatically..." -ForegroundColor Yellow
    Write-Host ""

    $installerUrl = "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe"
    $installerPath = "$env:TEMP\python-installer.exe"

    Write-Host "Downloading Python 3.12..."
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
    } catch {
        Write-Host "ERROR: Failed to download Python installer." -ForegroundColor Red
        Write-Host "Please install manually from https://www.python.org/downloads/"
        Read-Host "Press Enter to exit"
        exit 1
    }

    Write-Host "Installing Python (this may take a minute)..."
    Start-Process -FilePath $installerPath -ArgumentList "/quiet", "InstallAllUsers=0", "PrependPath=1", "Include_pip=1" -Wait
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue

    # Refresh PATH so we can use python immediately
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "User") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "Machine")

    # Verify it worked
    $pyCheck = python --version 2>&1
    if ($LASTEXITCODE -ne 0 -or "$pyCheck" -match "not found|not recognized") {
        Write-Host "ERROR: Python installation did not complete successfully." -ForegroundColor Red
        Write-Host "Please install manually from https://www.python.org/downloads/"
        Write-Host "Make sure to check 'Add Python to PATH' during install."
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "[OK] $pyCheck installed successfully" -ForegroundColor Green
} else {
    Write-Host "[OK] $pyCheck" -ForegroundColor Green
}

# Install pip dependencies
Write-Host ""
Write-Host "Installing Python dependencies..."
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: pip install failed. Try running as Administrator." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Dependencies installed" -ForegroundColor Green

# Install Playwright browsers
Write-Host ""
Write-Host "Installing Playwright browsers (Chromium)..."
Write-Host "This downloads ~150MB - please wait..."
playwright install chromium
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Playwright install may have had issues." -ForegroundColor Yellow
    Write-Host "Try running manually: playwright install chromium"
}
Write-Host "[OK] Playwright ready" -ForegroundColor Green

# Create required directories
New-Item -ItemType Directory -Path "resumes" -Force | Out-Null
New-Item -ItemType Directory -Path "data" -Force | Out-Null
New-Item -ItemType Directory -Path "logs" -Force | Out-Null

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Run '.\start.ps1' to start the app"
Write-Host "2. Go to Settings > Resumes & Routing to upload your PDF resumes"
Write-Host "3. Configure your email + LinkedIn cookie in Settings"
Write-Host "============================================" -ForegroundColor Green
Read-Host "Press Enter to exit"
