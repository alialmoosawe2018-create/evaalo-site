# Script to run LiveKit Agent correctly

Write-Host "Checking port 5000 status..." -ForegroundColor Cyan

# Check port 5000
$port5000 = netstat -ano | findstr :5000
if ($port5000) {
    Write-Host "Port 5000 is already in use (Backend is running)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Note: This is normal - Backend should run on port 5000" -ForegroundColor Cyan
    Write-Host "Agent connects to LiveKit, not HTTP port" -ForegroundColor Cyan
    Write-Host ""
}

Write-Host "Starting Agent..." -ForegroundColor Green
Write-Host ""

# Check .env.local
if (-not (Test-Path ".env.local")) {
    Write-Host "ERROR: .env.local file not found!" -ForegroundColor Red
    Write-Host "Please create .env.local and add required environment variables." -ForegroundColor Yellow
    exit 1
}

# Load environment variables from .env.local
Write-Host "Loading environment variables from .env.local..." -ForegroundColor Cyan
Get-Content ".env.local" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()
        # Remove quotes if present
        if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") {
            $value = $matches[1]
        }
        [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
        Write-Host "  Loaded: $key" -ForegroundColor Gray
    }
}
Write-Host "✅ Environment variables loaded" -ForegroundColor Green
Write-Host ""

# Check uv
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: uv is not installed!" -ForegroundColor Red
    Write-Host "Please install uv: https://github.com/astral-sh/uv" -ForegroundColor Yellow
    exit 1
}

# Install dependencies if needed
if (-not (Test-Path ".venv")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    uv sync
}

# Download models if needed
Write-Host "Checking for required models..." -ForegroundColor Yellow

# Run Agent
Write-Host ""
Write-Host "Starting LiveKit Agent..." -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

$env:PYTHONUNBUFFERED = "1"
# INFO أخف للفحص من LiveKit Playground؛ ضع DEBUG يدوياً عند الحاجة للتشخيص
$env:LOG_LEVEL = "INFO"

# ✅ FIX: Run video-interview-agent (Full agent with STT/LLM/TTS)
# Agent name: video-interview-agent
uv run python src/agent.py dev
