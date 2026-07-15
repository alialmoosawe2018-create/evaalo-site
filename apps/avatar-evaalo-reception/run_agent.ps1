# PowerShell script to run LiveKit Agent with logging

Write-Host "🚀 Starting LiveKit Agent with Beyond Presence Integration..." -ForegroundColor Green
Write-Host ""

# Check if .env.local exists
if (-not (Test-Path ".env.local")) {
    Write-Host "❌ ERROR: .env.local file not found!" -ForegroundColor Red
    Write-Host "Please create .env.local and add required environment variables." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Required variables:" -ForegroundColor Yellow
    Write-Host "  - LIVEKIT_URL" -ForegroundColor Cyan
    Write-Host "  - LIVEKIT_API_KEY" -ForegroundColor Cyan
    Write-Host "  - LIVEKIT_API_SECRET" -ForegroundColor Cyan
    Write-Host "  - OPENAI_API_KEY" -ForegroundColor Cyan
    Write-Host "  - BEYOND_PRESENCE_API_KEY" -ForegroundColor Cyan
    Write-Host "  - BEYOND_PRESENCE_AVATAR_ID" -ForegroundColor Cyan
    exit 1
}

# Check if uv is installed
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "❌ ERROR: uv is not installed!" -ForegroundColor Red
    Write-Host "Please install uv: https://github.com/astral-sh/uv" -ForegroundColor Yellow
    exit 1
}

# Check if dependencies are installed
if (-not (Test-Path ".venv")) {
    Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
    uv sync
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install dependencies!" -ForegroundColor Red
        exit 1
    }
}

# Download required files (VAD models, etc.)
Write-Host "📥 Downloading required models..." -ForegroundColor Yellow
uv run python src/agent.py download-files
Write-Host ""

# Set environment variables for better logging
$env:PYTHONUNBUFFERED = "1"
$env:LOG_LEVEL = "INFO"

Write-Host "✅ Starting Agent..." -ForegroundColor Green
Write-Host "📍 Logs will appear below:" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

# Run the agent in dev mode with detailed logging
uv run python src/agent.py dev
