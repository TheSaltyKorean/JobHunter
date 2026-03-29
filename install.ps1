Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  JobApplicationBot - First-Time Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
try {
    $pyVersion = python --version 2>&1
    Write-Host "[OK] $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Python not found." -ForegroundColor Red
    Write-Host "Please install Python 3.10+ from https://python.org"
    Read-Host "Press Enter to exit"
    exit 1
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

# Copy resumes reminder
Write-Host ""
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "IMPORTANT: Copy your resume PDFs to the" -ForegroundColor Yellow
Write-Host "'resumes' folder with these exact names:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  resumes\2025 Randy Walker - IT Executive.pdf"
Write-Host "  resumes\2025 Randy Walker - Tech Leader.pdf"
Write-Host "  resumes\2025 Randy Walker - Cloud.pdf"
Write-Host "  resumes\2025 Randy Walker - Cloud Contract.pdf"
Write-Host "============================================" -ForegroundColor Yellow

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Copy your 4 PDF resumes to the 'resumes' folder"
Write-Host "2. Run '.\start.ps1' to start the app"
Write-Host "3. Open Settings and configure your email + LinkedIn cookie"
Write-Host "============================================" -ForegroundColor Green
Read-Host "Press Enter to exit"
