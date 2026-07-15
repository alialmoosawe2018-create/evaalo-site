# Simple script to add LiveKit environment variables to .env.local

$envFile = ".env.local"

Write-Host "📝 Adding LiveKit environment variables to $envFile..." -ForegroundColor Cyan

# Check if file exists, if not create it
if (-not (Test-Path $envFile)) {
    Write-Host "⚠️ Creating new $envFile file..." -ForegroundColor Yellow
    New-Item -Path $envFile -ItemType File -Force | Out-Null
}

# Read existing content
$content = @()
if (Test-Path $envFile) {
    $content = Get-Content $envFile
}

# Check if LIVEKIT variables already exist
$hasLivekit = $false
foreach ($line in $content) {
    if ($line -match '^\s*LIVEKIT_') {
        $hasLivekit = $true
        break
    }
}

if ($hasLivekit) {
    Write-Host "⚠️ LIVEKIT variables already exist in $envFile" -ForegroundColor Yellow
    Write-Host "   Skipping addition. If you need to update, edit the file manually." -ForegroundColor Yellow
    exit 0
}

# Add LiveKit section
$content += ""
$content += "# ============================================"
$content += "# LiveKit Configuration"
$content += "# ============================================"
$content += "LIVEKIT_URL=wss://evaalo-qk1twe6k.livekit.cloud"
$content += "LIVEKIT_API_KEY=APIPfHsukAntKDq"
$content += "LIVEKIT_API_SECRET=GDCBeJv6X8Tfz7qweeQZF1oBUukejh2JEnFwXOwsrMaA"
$content += ""

# Write to file
$content | Set-Content $envFile

Write-Host "✅ Successfully added LiveKit environment variables!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Added variables:" -ForegroundColor Cyan
Write-Host "   - LIVEKIT_URL=wss://evaalo-qk1twe6k.livekit.cloud" -ForegroundColor Gray
Write-Host "   - LIVEKIT_API_KEY=APIPfHsukAntKDq" -ForegroundColor Gray
Write-Host "   - LIVEKIT_API_SECRET=***" -ForegroundColor Gray
Write-Host ""
Write-Host "🚀 You can now run the Agent:" -ForegroundColor Green
Write-Host "   uv run python src/agent.py dev" -ForegroundColor Yellow
