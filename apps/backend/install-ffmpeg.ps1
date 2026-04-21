# ============================================
# FFmpeg Installation Script
# ============================================
# 
# IMPORTANT: Run this script as Administrator
# 
# How to run:
# 1. Press Win + X
# 2. Select "Windows PowerShell (Admin)" or "Terminal (Admin)"
# 3. Navigate to backend folder:
#    cd C:\Users\Alnaji-AliMD\.cursor\cursor-react\apps\backend
# 4. Run the script:
#    .\install-ffmpeg.ps1
#
# ============================================

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Installing FFmpeg" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check for Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host ""
    Write-Host "Solution:" -ForegroundColor Yellow
    Write-Host "1. Press Win + X" -ForegroundColor Yellow
    Write-Host "2. Select 'Windows PowerShell (Admin)' or 'Terminal (Admin)'" -ForegroundColor Yellow
    Write-Host "3. Run the script again" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "OK: Administrator privileges available" -ForegroundColor Green
Write-Host ""

# Check if Chocolatey is installed
$chocoInstalled = Get-Command choco -ErrorAction SilentlyContinue

if (-not $chocoInstalled) {
    Write-Host "WARNING: Chocolatey not installed. Installing..." -ForegroundColor Yellow
    Write-Host ""
    
    try {
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
        Write-Host "OK: Chocolatey installed successfully" -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host "ERROR: Failed to install Chocolatey: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "Alternative: Download FFmpeg manually from:" -ForegroundColor Yellow
        Write-Host "https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor Cyan
        exit 1
    }
} else {
    Write-Host "OK: Chocolatey is already installed" -ForegroundColor Green
    Write-Host ""
}

# Remove lock file if it exists
$lockFile = "C:\ProgramData\chocolatey\lib\c00565a56f0e64a50f2ea5badcb97694d43e0755"
if (Test-Path $lockFile) {
    Write-Host "Cleaning up lock file..." -ForegroundColor Yellow
    try {
        Remove-Item -Path $lockFile -Force
        Write-Host "OK: Lock file removed" -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host "WARNING: Could not remove lock file (may not be necessary)" -ForegroundColor Yellow
        Write-Host ""
    }
}

# Check if FFmpeg is already installed
$ffmpegInstalled = Get-Command ffmpeg -ErrorAction SilentlyContinue

if ($ffmpegInstalled) {
    Write-Host "OK: FFmpeg is already installed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Checking version:" -ForegroundColor Cyan
    ffmpeg -version | Select-Object -First 3
    Write-Host ""
    exit 0
}

# Install FFmpeg
Write-Host "Downloading and installing FFmpeg..." -ForegroundColor Cyan
Write-Host ""

try {
    choco install ffmpeg -y
    Write-Host ""
    Write-Host "OK: FFmpeg installed successfully!" -ForegroundColor Green
    Write-Host ""
    
    # Verify installation
    Write-Host "Verifying installation:" -ForegroundColor Cyan
    $ffmpegPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($ffmpegPath) {
        Write-Host "OK: FFmpeg available at: $($ffmpegPath.Source)" -ForegroundColor Green
        Write-Host ""
        Write-Host "Checking version:" -ForegroundColor Cyan
        ffmpeg -version | Select-Object -First 3
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Cyan
        Write-Host "OK: Installation completed successfully!" -ForegroundColor Green
        Write-Host "============================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "IMPORTANT: Restart Terminal/Backend now" -ForegroundColor Yellow
        Write-Host ""
    } else {
        Write-Host "WARNING: FFmpeg installed but not available in PATH" -ForegroundColor Yellow
        Write-Host "Restart Terminal/Backend" -ForegroundColor Yellow
    }
} catch {
    Write-Host ""
    Write-Host "ERROR: Failed to install FFmpeg: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Alternative: Download FFmpeg manually from:" -ForegroundColor Yellow
    Write-Host "https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "See FFMPEG_INSTALLATION.md for instructions" -ForegroundColor Yellow
    exit 1
}
